import { app, powerMonitor, powerSaveBlocker, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PowerSettings } from '@remocoder/shared'

const DEFAULT_POWER_SETTINGS: PowerSettings = { preventSleepOnAC: false, preventSleepOnBattery: false }

let mainWindow: BrowserWindow | null = null
let blockerId: number | null = null
let isOnAC = true
let settings: PowerSettings = { ...DEFAULT_POWER_SETTINGS }

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'power-settings.json')
}

function loadPowerSettings(): PowerSettings {
  try {
    const raw = JSON.parse(readFileSync(getSettingsPath(), 'utf-8'))
    if (typeof raw.preventSleepOnAC === 'boolean' && typeof raw.preventSleepOnBattery === 'boolean') {
      return raw as PowerSettings
    }
  } catch {
    // ファイルなし or 不正 → デフォルト値
  }
  return { ...DEFAULT_POWER_SETTINGS }
}

function persistPowerSettings(s: PowerSettings): void {
  writeFileSync(getSettingsPath(), JSON.stringify(s), 'utf-8')
}

/** 現在の設定と電源状態に基づき powerSaveBlocker を開始/停止する（冪等） */
function applyBlocker(): void {
  const shouldBlock = isOnAC ? settings.preventSleepOnAC : settings.preventSleepOnBattery

  if (shouldBlock && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep')
    console.log(`[power] powerSaveBlocker started (id=${blockerId}, isOnAC=${isOnAC})`)
  } else if (!shouldBlock && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    console.log(`[power] powerSaveBlocker stopped (id=${blockerId})`)
    blockerId = null
  }
}

function notifyRenderer(): void {
  mainWindow?.webContents.send('power-status-changed', {
    isOnAC,
    isBlockerActive: blockerId !== null,
  })
}

export function initPowerManager(win: BrowserWindow): void {
  mainWindow = win

  settings = loadPowerSettings()
  isOnAC = !powerMonitor.isOnBatteryPower()

  applyBlocker()

  powerMonitor.on('on-ac', () => {
    isOnAC = true
    applyBlocker()
    notifyRenderer()
  })

  powerMonitor.on('on-battery', () => {
    isOnAC = false
    applyBlocker()
    notifyRenderer()
  })

  win.on('closed', () => {
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
    mainWindow = null
  })
}

export function getPowerSettings(): PowerSettings {
  return { ...settings }
}

export function setPowerSetting(key: keyof PowerSettings, enabled: boolean): void {
  settings = { ...settings, [key]: enabled }
  persistPowerSettings(settings)
  applyBlocker()
}

export function getPowerStatus(): { isOnAC: boolean; isBlockerActive: boolean } {
  return { isOnAC, isBlockerActive: blockerId !== null }
}
