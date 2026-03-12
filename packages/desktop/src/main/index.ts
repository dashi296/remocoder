import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { startPtyServer, rotateToken } from './pty-server'
import { getTailscaleIP } from './tailscale'
import type { SessionInfo } from '@remocoder/shared'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let tailscaleIp: string | null = null
let authToken = ''
let currentSessions: SessionInfo[] = []

function createWindow() {
  win = new BrowserWindow({
    width: 360,
    height: 560,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ウィンドウを閉じてもアプリは終了しない（トレイに残る）
  win.on('close', (e) => {
    e.preventDefault()
    win?.hide()
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
  ipcMain.handle('get-tailscale-ip', () => tailscaleIp)
  ipcMain.handle('get-token', () => getToken())
  ipcMain.handle('get-sessions', () => currentSessions)
  ipcMain.handle('rotate-token', () => {
    const newToken = rotateToken()
    authToken = newToken
    // トレイメニューのトークン表示を更新
    setupTray(newToken)
    // レンダラーにも通知
    win?.webContents.send('token-rotated', newToken)
    return newToken
  })
}

app.whenReady().then(async () => {
  const { getToken } = startPtyServer(undefined, (sessions) => {
    currentSessions = sessions
    win?.webContents.send('sessions-update', sessions)
  })

  authToken = getToken()
  tailscaleIp = await getTailscaleIP()

  createWindow()
  setupTray(getToken())
  setupIpc(getToken)
})

app.on('window-all-closed', () => {
  // トレイアプリのため終了しない
})
