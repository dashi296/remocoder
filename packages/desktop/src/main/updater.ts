import { autoUpdater, type UpdateInfo as EuUpdateInfo } from 'electron-updater'
import { app, type BrowserWindow } from 'electron'
import type { UpdateInfo } from '@remocoder/shared'

let mainWindow: BrowserWindow | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let initialized = false

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
  // 二重初期化防止
  if (initialized) return
  initialized = true

  mainWindow = win

  autoUpdater.autoDownload = true
  // Major バージョンは終了時の自動インストールを無効化し、ユーザーの明示的な操作を要求する
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info: EuUpdateInfo) => {
    const updateInfo = toUpdateInfo(info)
    // Major バージョンは互換性確認が必要なため終了時の自動インストールを抑制する
    if (updateInfo.isMajor) {
      autoUpdater.autoInstallOnAppQuit = false
    }
    mainWindow?.webContents.send('update-available', updateInfo)
  })

  autoUpdater.on('update-downloaded', (info: EuUpdateInfo) => {
    mainWindow?.webContents.send('update-downloaded', toUpdateInfo(info))
  })

  autoUpdater.on('error', (err: Error) => {
    // 開発環境では publish 設定がないためエラーが発生するが無視する
    const isDevNoPublish =
      err.message.includes('No published versions') ||
      err.message.includes('net::ERR_FILE_NOT_FOUND')
    if (!isDevNoPublish) {
      console.error('[updater] error:', err)
      mainWindow?.webContents.send('update-error', { message: err.message })
    }
  })

  win.on('closed', () => {
    mainWindow = null
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  })

  // 起動時チェック
  checkForUpdates()

  // 1時間ごとに定期チェック
  intervalId = setInterval(checkForUpdates, 60 * 60 * 1000)
}

export function checkForUpdates(): Promise<void> {
  return autoUpdater.checkForUpdates().then(() => undefined)
}

export function installUpdate(): void {
  try {
    autoUpdater.quitAndInstall()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[updater] quitAndInstall failed:', err)
    mainWindow?.webContents.send('update-error', { message })
  }
}
