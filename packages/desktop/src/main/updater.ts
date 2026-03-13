import { app, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo as EuUpdateInfo } from 'electron-updater'
import type { UpdateInfo } from '@remocoder/shared'

const { autoUpdater } = electronUpdater

let mainWindow: BrowserWindow | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let initialized = false
let downloading = false

function parseMajor(version: string): number {
  return parseInt(version.split('.')[0], 10)
}

function toUpdateInfo(info: EuUpdateInfo, currentMajor: number): UpdateInfo {
  return {
    version: info.version,
    isMajor: parseMajor(info.version) > currentMajor,
  }
}

export function setupAutoUpdater(win: BrowserWindow): void {
  // 二重初期化防止
  if (initialized) return
  initialized = true

  mainWindow = win

  // app.isReady() 後に呼ばれることが保証されているため、ここで計算する
  const currentVersion = app.getVersion()
  const currentMajor = parseMajor(currentVersion)
  console.log(`[updater] current version: ${currentVersion}, major: ${currentMajor}`)

  // 自動ダウンロードは無効化し、バージョン種別に応じて手動制御する
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info: EuUpdateInfo) => {
    const updateInfo = toUpdateInfo(info, currentMajor)
    mainWindow?.webContents.send('update-available', updateInfo)

    if (!updateInfo.isMajor) {
      // Minor / Patch: バックグラウンド自動ダウンロードし終了時に自動適用
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.downloadUpdate().catch((err: Error) => {
        console.error('[updater] downloadUpdate failed:', err)
        mainWindow?.webContents.send('update-error', { message: err.message })
      })
    } else {
      // Major: 前回 Minor 更新で true になっていた場合に備えてリセット
      autoUpdater.autoInstallOnAppQuit = false
    }
  })

  autoUpdater.on('update-downloaded', (info: EuUpdateInfo) => {
    mainWindow?.webContents.send('update-downloaded', toUpdateInfo(info, currentMajor))
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
    initialized = false
    downloading = false
    autoUpdater.removeAllListeners()
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
  return autoUpdater.checkForUpdates().then((result) => {
    if (result === null) {
      console.warn('[updater] checkForUpdates returned null — updater may not be configured')
    }
  })
}

export function downloadUpdate(): void {
  if (downloading) return
  downloading = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.downloadUpdate()
    .catch((err: Error) => {
      console.error('[updater] downloadUpdate failed:', err)
      mainWindow?.webContents.send('update-error', { message: err.message })
    })
    .finally(() => {
      downloading = false
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
