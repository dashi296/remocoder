import { autoUpdater, type UpdateInfo as EuUpdateInfo } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'

export interface UpdateInfo {
  version: string
  isMajor: boolean
}

let mainWindow: BrowserWindow | null = null

function getCurrentMajorVersion(): number {
  return parseInt(app.getVersion().split('.')[0], 10)
}

function toUpdateInfo(info: EuUpdateInfo): UpdateInfo {
  const newMajor = parseInt(info.version.split('.')[0], 10)
  return {
    version: info.version,
    isMajor: newMajor > getCurrentMajorVersion(),
  }
}

export function setupAutoUpdater(win: BrowserWindow): void {
  mainWindow = win

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: EuUpdateInfo) => {
    mainWindow?.webContents.send('update-available', toUpdateInfo(info))
  })

  autoUpdater.on('update-downloaded', (info: EuUpdateInfo) => {
    mainWindow?.webContents.send('update-downloaded', toUpdateInfo(info))
  })

  autoUpdater.on('error', (err: Error) => {
    // macOS では署名なしの場合にエラーが発生する可能性があるが、
    // ユーザーへの通知は update-available イベントで行うため無視する
    console.error('[updater] error:', err.message)
  })

  // 起動時チェック
  checkForUpdates()

  // 1時間ごとに定期チェック
  setInterval(checkForUpdates, 60 * 60 * 1000)
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err: Error) => {
    console.error('[updater] checkForUpdates failed:', err.message)
  })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
