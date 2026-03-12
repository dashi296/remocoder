import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import {
  startPtyServer,
  rotateToken,
  initToken,
  desktopCreateSession,
  desktopGetScrollback,
  desktopSendInput,
  desktopResize,
  getSessions,
} from './pty-server'
import { getTailscaleIP } from './tailscale'
import type { SessionInfo } from '@remocoder/shared'
import { v4 as uuidv4 } from 'uuid'

function loadOrCreateToken(): string {
  const tokenPath = join(app.getPath('userData'), 'auth-token.json')
  try {
    const { token } = JSON.parse(readFileSync(tokenPath, 'utf-8'))
    if (typeof token === 'string' && token.length > 0) return token
  } catch {
    // ファイルが存在しない or 読み込み失敗 → 新規生成
  }
  const token = uuidv4()
  writeFileSync(tokenPath, JSON.stringify({ token }), 'utf-8')
  return token
}

// シングルインスタンス強制
if (!app.requestSingleInstanceLock()) {
  app.exit()
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
let tailscaleIp: string | null = null
let authToken = ''
let currentSessions: SessionInfo[] = []

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// 通常ウィンドウサイズ / ターミナル表示時のウィンドウサイズ
const WINDOW_NORMAL = { width: 360, height: 560 }
const WINDOW_TERMINAL = { width: 1000, height: 680 }

function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_NORMAL.width,
    height: WINDOW_NORMAL.height,
    resizable: false,
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

  // 開発モードはウィンドウを閉じたら終了、本番はトレイに残る
  win.on('close', (e) => {
    if (isDev) {
      app.exit()
    } else {
      e.preventDefault()
      win?.hide()
    }
  })
}

function setupTray(token: string) {
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Remocoder')

  const updateMenu = () => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Tailscale IP: ${tailscaleIp ?? '未接続'}`, enabled: false },
        { label: `Token: ${token}`, enabled: false },
        { type: 'separator' },
        {
          label: 'ウィンドウを表示',
          click: () => {
            win?.show()
            win?.focus()
          },
        },
        { type: 'separator' },
        { label: '終了', click: () => app.exit() },
      ]),
    )
  }

  updateMenu()
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
  ipcMain.handle('get-sessions', () => currentSessions)
  ipcMain.handle('rotate-token', () => {
    const newToken = rotateToken()
    authToken = newToken
    const tokenPath = join(app.getPath('userData'), 'auth-token.json')
    writeFileSync(tokenPath, JSON.stringify({ token: newToken }), 'utf-8')
    setupTray(newToken)
    win?.webContents.send('token-rotated', newToken)
    return newToken
  })

  // ── デスクトップターミナル用ハンドラ ────────────────────────────────────────

  /** 新規PTYセッションを作成し、セッションIDを返す */
  ipcMain.handle('pty-create', () => {
    return desktopCreateSession()
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
    win?.setResizable(true)
    win?.setSize(WINDOW_TERMINAL.width, WINDOW_TERMINAL.height)
    win?.center()
    win?.setResizable(false)
    win?.webContents.send('terminal-opened', sessionId)
  })

  /** ターミナルウィンドウを閉じる（ウィンドウを縮小） */
  ipcMain.handle('close-terminal-window', () => {
    win?.setResizable(true)
    win?.setSize(WINDOW_NORMAL.width, WINDOW_NORMAL.height)
    win?.center()
    win?.setResizable(false)
    win?.webContents.send('terminal-closed')
  })
}

app.whenReady().then(async () => {
  initToken(loadOrCreateToken())

  const { getToken } = startPtyServer(undefined, {
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

  authToken = getToken()
  tailscaleIp = await getTailscaleIP()

  createWindow()
  setupTray(getToken())
  setupIpc(getToken)

  // Tailscale IP を定期的に更新（30秒ごと）
  setInterval(async () => {
    const newIp = await getTailscaleIP()
    if (newIp !== tailscaleIp) {
      tailscaleIp = newIp
      win?.webContents.send('tailscale-ip-updated', newIp)
    }
  }, 30000)
})

app.on('window-all-closed', () => {
  // トレイアプリのため終了しない
})
