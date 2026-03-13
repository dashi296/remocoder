import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo as EuUpdateInfo } from 'electron-updater'
import type { UpdateInfo } from '@remocoder/shared'

const { autoUpdater } = electronUpdater

let mainWindow: BrowserWindow | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let initialized = false

/** アプリ起動後に変わらないため、モジュールロード時に一度だけ計算する */
const CURRENT_MAJOR = parseInt(app.getVersion().split('.')[0], 10)

function parseMajor(version: string): number {
  return parseInt(version.split('.')[0], 10)
}

function toUpdateInfo(info: EuUpdateInfo): UpdateInfo {
  return {
    version: info.version,
    isMajor: parseMajor(info.version) > CURRENT_MAJOR,
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
    // Major: ユーザーの明示的な操作を待つ（downloadUpdate() で開始）
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
    if (isExpectedDevError) {
      console.log('[updater] dev: ignoring expected error:', err.message)
      return
    }
    console.error('[updater] error:', err)
    mainWindow?.webContents.send('update-error', { message: err.message })
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
    mainWindow?.webContents.send('update-error', { message: String(err) })
  })

  // 1時間ごとに定期チェック
  intervalId = setInterval(() => {
    checkForUpdates().catch((err) => {
      console.error('[updater] periodic check failed:', err)
      mainWindow?.webContents.send('update-error', { message: String(err) })
    })
  }, 60 * 60 * 1000)
}

export function checkForUpdates(): Promise<void> {
  return autoUpdater.checkForUpdates().then(() => undefined)
}

export function downloadUpdate(): void {
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.downloadUpdate().catch((err: Error) => {
    console.error('[updater] downloadUpdate failed:', err)
    mainWindow?.webContents.send('update-error', { message: err.message })
  })
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
