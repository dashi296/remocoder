import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo as EuUpdateInfo } from 'electron-updater'
import type { UpdateInfo } from '@remocoder/shared'

const { autoUpdater } = electronUpdater

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

  // 自動ダウンロードは無効化し、バージョン種別に応じて手動制御する
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info: EuUpdateInfo) => {
    const updateInfo = toUpdateInfo(info)
    mainWindow?.webContents.send('update-available', updateInfo)

    if (!updateInfo.isMajor) {
      // Minor / Patch: バックグラウンド自動ダウンロードし終了時に自動適用
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.downloadUpdate().catch((err: Error) => {
        console.error('[updater] downloadUpdate failed:', err)
        mainWindow?.webContents.send('update-error', { message: err.message })
      })
    }
    // Major: ユーザーの明示的な操作を待つ（自動ダウンロードしない）
  })

  autoUpdater.on('update-downloaded', (info: EuUpdateInfo) => {
    mainWindow?.webContents.send('update-downloaded', toUpdateInfo(info))
  })

  autoUpdater.on('error', (err: Error) => {
    // 開発環境（パッケージ化前）では publish 設定がないためエラーが発生するが無視する
    const isDev = !app.isPackaged
    const isExpectedDevError =
      isDev &&
      (err.message.includes('No published versions') ||
        err.message.includes('net::ERR_FILE_NOT_FOUND'))
    if (!isExpectedDevError) {
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
  checkForUpdates().catch((err) => {
    console.error('[updater] startup check failed:', err)
  })

  // 1時間ごとに定期チェック
  intervalId = setInterval(() => {
    checkForUpdates().catch((err) => {
      console.error('[updater] periodic check failed:', err)
    })
  }, 60 * 60 * 1000)
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
