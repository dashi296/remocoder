import { app, Tray, Menu, nativeImage } from 'electron'
import { startPtyServer } from './pty-server'
import { getTailscaleIP } from './tailscale'

app.whenReady().then(async () => {
  const { token } = startPtyServer()
  const tailscaleIp = await getTailscaleIP()

  const tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Remocoder')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Tailscale IP: ${tailscaleIp ?? '未接続'}`, enabled: false },
      { label: `Token: ${token}`, enabled: false },
      { type: 'separator' },
      { label: '終了', click: () => app.quit() },
    ]),
  )
})

app.on('window-all-closed', () => {
  // トレイアプリのため終了しない
})
