import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import {
  startPtyServer,
  shutdownPtyServer,
  rotateToken,
  initToken,
  desktopCreateSession,
  desktopGetScrollback,
  desktopSendInput,
  desktopResize,
  getMultiplexerSessions,
} from './pty-server'
import { getTailscaleIP } from './tailscale'
import { setupAutoUpdater, checkForUpdates, downloadUpdate, installUpdate } from './updater'
import { initPowerManager, destroyPowerManager, getPowerSettings, setPowerSetting, getPowerStatus } from './power-manager'
import type { SessionInfo, SessionSource, PowerSettings } from '@remocoder/shared'
import { v4 as uuidv4 } from 'uuid'

function getTokenPath(): string {
  return join(app.getPath('userData'), 'auth-token.json')
}

function persistToken(token: string): void {
  writeFileSync(getTokenPath(), JSON.stringify({ token }), 'utf-8')
}

function loadOrCreateToken(): string {
  try {
    const { token } = JSON.parse(readFileSync(getTokenPath(), 'utf-8'))
    if (typeof token === 'string' && token.length > 0) return token
  } catch {
    // ファイルが存在しない or 読み込み失敗 → 新規生成
  }
  const token = uuidv4()
  persistToken(token)
  return token
}

// シングルインスタンス強制
if (!app.requestSingleInstanceLock()) {
  app.exit()
}

app.on('second-instance', () => {
  win?.show()
  win?.focus()
})

let win: BrowserWindow | null = null
let tray: Tray | null = null
let tailscaleIp: string | null = null
let currentSessions: SessionInfo[] = []

const isDev = !!process.env['ELECTRON_RENDERER_URL']

function loadNativeImage(relativePath: string): Electron.NativeImage | null {
  const fullPath = join(app.getAppPath(), relativePath)
  const image = nativeImage.createFromPath(fullPath)
  if (image.isEmpty()) {
    console.warn('[icon] failed to load image from:', fullPath)
    return null
  }
  return image
}

const ICON_DEV = 'build/icon-dev.png'
const ICON_PROD = 'build/icon.png'
const ICON_TRAY = 'build/icon_tray.png'
const TRAY_ICON_SIZE = 22 // macOS menu bar standard

// 通常ウィンドウサイズ / ターミナル表示時のウィンドウサイズ
const WINDOW_NORMAL = { width: 360, height: 560 }
const WINDOW_TERMINAL = { width: 1000, height: 680 }

function loadAppIcon(): Electron.NativeImage | null {
  if (app.isPackaged) return null
  return loadNativeImage(isDev ? ICON_DEV : ICON_PROD)
}

function createWindow(icon: Electron.NativeImage | null) {
  win = new BrowserWindow({
    width: WINDOW_NORMAL.width,
    height: WINDOW_NORMAL.height,
    resizable: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (isDev) {
    const thisWin = win
    thisWin.on('page-title-updated', (e) => e.preventDefault())
    thisWin.webContents.once('did-finish-load', () => thisWin.setTitle('RemoCoder [Dev]'))
  }

  // 開発モードはウィンドウを閉じたら終了、本番はトレイに残る
  win.on('close', (e) => {
    if (isDev) {
      app.quit()
    } else {
      e.preventDefault()
      win?.hide()
    }
  })
}

function resizeWindow(size: { width: number; height: number }): void {
  win?.setResizable(true)
  win?.setSize(size.width, size.height)
  win?.center()
  win?.setResizable(false)
}

function loadTrayIcon(): Electron.NativeImage {
  if (isDev) {
    const devIcon = loadNativeImage(ICON_DEV)
    if (devIcon) return devIcon.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE })
    return nativeImage.createEmpty()
  }
  if (process.platform === 'darwin') {
    // macOS: 白・透明背景のテンプレートアイコン（ダーク/ライトモード自動対応）
    const trayIcon = loadNativeImage(ICON_TRAY)
    if (trayIcon) {
      trayIcon.setTemplateImage(true)
      return trayIcon
    }
  }
  // Windows / Linux: 白アイコンは明るいタスクバーで不可視になるためカラーにフォールバック
  return loadNativeImage(ICON_PROD) ?? nativeImage.createEmpty()
}

function setupTray(token: string) {
  tray?.destroy()
  tray = new Tray(loadTrayIcon())
  tray.setToolTip(isDev ? 'RemoCoder [Dev]' : 'RemoCoder')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Tailscale IP: ${tailscaleIp ?? 'Disconnected'}`, enabled: false },
      { label: `Token: ${token}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => {
          win?.show()
          win?.focus()
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('double-click', () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      win?.show()
      win?.focus()
    }
  })
}

function setupIpc(getToken: () => string) {
  // ── 既存ハンドラ ──────────────────────────────────────────────────────────
  ipcMain.handle('get-tailscale-ip', () => tailscaleIp)
  ipcMain.handle('get-token', () => getToken())
  ipcMain.handle('get-server-name', () => hostname())
  ipcMain.handle('get-sessions', () => currentSessions)
  ipcMain.handle('rotate-token', () => {
    const newToken = rotateToken()
    persistToken(newToken)
    setupTray(newToken)
    win?.webContents.send('token-rotated', newToken)
    return newToken
  })

  // ── デスクトップターミナル用ハンドラ ────────────────────────────────────────

  /** 新規PTYセッションを作成し、セッションIDを返す */
  ipcMain.handle('pty-create', (_e, source?: SessionSource) => {
    return desktopCreateSession(source)
  })

  /** tmux / screen / zellij のセッション一覧を返す */
  ipcMain.handle('get-multiplexer-sessions', () => {
    return getMultiplexerSessions()
  })

  /** セッションのスクロールバックを返す */
  ipcMain.handle('pty-get-scrollback', (_e, sessionId: string) => {
    return desktopGetScrollback(sessionId)
  })

  /** PTYへ入力を送る */
  ipcMain.on('pty-input', (_e, { sessionId, data }: { sessionId: string; data: string }) => {
    desktopSendInput(sessionId, data)
  })

  /** PTYをリサイズする */
  ipcMain.on(
    'pty-resize',
    (_e, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
      desktopResize(sessionId, cols, rows)
    },
  )

  /** ターミナルウィンドウを開く（ウィンドウを拡大し、Rendererにセッションを通知） */
  ipcMain.handle('open-terminal-window', (_e, sessionId: string) => {
    resizeWindow(WINDOW_TERMINAL)
    win?.webContents.send('terminal-opened', sessionId)
  })

  /** ターミナルウィンドウを閉じる（ウィンドウを縮小） */
  ipcMain.handle('close-terminal-window', () => {
    resizeWindow(WINDOW_NORMAL)
    win?.webContents.send('terminal-closed')
  })

  // ── 電源管理用ハンドラ ────────────────────────────────────────────────────

  ipcMain.handle('get-power-settings', () => getPowerSettings())

  ipcMain.handle(
    'set-power-setting',
    (_e, { key, enabled }: { key: keyof PowerSettings; enabled: boolean }) => {
      setPowerSetting(key, enabled)
    },
  )

  ipcMain.handle('get-power-status', () => getPowerStatus())

  // ── 自動アップデート用ハンドラ ──────────────────────────────────────────────

  /** 手動で更新チェックをトリガー（エラーは update-error として通知済みのため void を返す） */
  ipcMain.handle('updater-check', () => {
    checkForUpdates().catch((err) => {
      console.error('[updater] manual check failed:', err)
      win?.webContents.send('update-error', { message: String(err) })
    })
  })

  /** メジャーアップデートをユーザー操作でダウンロード開始 */
  ipcMain.handle('updater-download', () => {
    downloadUpdate()
  })

  /** ダウンロード済みアップデートを適用して再起動 */
  ipcMain.handle('updater-install', () => {
    installUpdate()
  })
}

let tailscalePollingId: ReturnType<typeof setInterval> | undefined
let isQuitting = false

app.whenReady().then(async () => {
  const appIcon = loadAppIcon()
  if (appIcon && process.platform === 'darwin') {
    app.dock?.setIcon(appIcon)
  }

  initToken(loadOrCreateToken())

  const { wss, getToken } = startPtyServer(undefined, {
    onSessionsChange: (sessions) => {
      currentSessions = sessions
      win?.webContents.send('sessions-update', sessions)
    },
    onPtyOutput: (sessionId, data) => {
      win?.webContents.send('pty-output', { sessionId, data })
    },
    onPtyExit: (sessionId, exitCode) => {
      win?.webContents.send('pty-exit', { sessionId, exitCode })
    },
  })

  tailscaleIp = await getTailscaleIP()

  createWindow(appIcon)
  setupTray(getToken())
  setupIpc(getToken)

  if (win) {
    setupAutoUpdater(win)
    initPowerManager(win)
  }

  // Tailscale IP を定期的に更新（30秒ごと）
  tailscalePollingId = setInterval(() => {
    getTailscaleIP()
      .then((newIp) => {
        if (newIp !== tailscaleIp) {
          tailscaleIp = newIp
          win?.webContents.send('tailscale-ip-updated', newIp)
        }
      })
      .catch((err) => {
        console.error('[main] Tailscale IP ポーリング中に予期しないエラー:', err)
      })
  }, 30000)

  app.on('before-quit', (e) => {
    if (isQuitting) return
    isQuitting = true
    e.preventDefault()
    clearInterval(tailscalePollingId)
    destroyPowerManager()
    shutdownPtyServer(wss)
      .catch((err) => console.error('[main] shutdown error:', err))
      .finally(() => app.exit(0))
  })
})

app.on('window-all-closed', () => {
  // トレイアプリのため終了しない
})
