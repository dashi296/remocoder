import { app, powerMonitor, powerSaveBlocker, type BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PowerSettings } from '@remocoder/shared'

const DEFAULT_POWER_SETTINGS: PowerSettings = {
  preventSleepOnAC: false,
  preventSleepOnBattery: false,
  preventLidSleep: false,
}

let mainWindow: BrowserWindow | null = null
let blockerId: number | null = null
let caffeinateProcess: ChildProcess | null = null
let isOnAC = true
let settings: PowerSettings = { ...DEFAULT_POWER_SETTINGS }

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'power-settings.json')
}

function loadPowerSettings(): PowerSettings {
  try {
    const raw = JSON.parse(readFileSync(getSettingsPath(), 'utf-8'))
    if (typeof raw.preventSleepOnAC === 'boolean' && typeof raw.preventSleepOnBattery === 'boolean') {
      return {
        preventSleepOnAC: raw.preventSleepOnAC,
        preventSleepOnBattery: raw.preventSleepOnBattery,
        preventLidSleep: typeof raw.preventLidSleep === 'boolean' ? raw.preventLidSleep : false,
      }
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

  // 蓋閉じスリープ抑制（macOS のみ・caffeinate -s はAC時のみ有効）
  applyCaffeinate()
}

/** caffeinate プロセスを開始/停止する（macOS 専用・冪等） */
function applyCaffeinate(): void {
  const shouldCaffeinate = process.platform === 'darwin' && settings.preventLidSleep

  if (shouldCaffeinate && caffeinateProcess === null) {
    // -s: システムスリープを抑制（AC電源時のみ有効）
    // -i: アイドルスリープを抑制
    caffeinateProcess = spawn('caffeinate', ['-s', '-i'], { detached: false, stdio: 'ignore' })
    caffeinateProcess.on('exit', () => {
      caffeinateProcess = null
    })
    console.log(`[power] caffeinate started (pid=${caffeinateProcess.pid})`)
  } else if (!shouldCaffeinate && caffeinateProcess !== null) {
    const proc = caffeinateProcess
    caffeinateProcess = null
    proc.kill()
    console.log('[power] caffeinate stopped')
  }
}

function notifyRenderer(): void {
  mainWindow?.webContents.send('power-status-changed', {
    isOnAC,
    isBlockerActive: blockerId !== null,
    isCaffeinateActive: caffeinateProcess !== null,
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
    if (caffeinateProcess !== null) {
      const proc = caffeinateProcess
      caffeinateProcess = null
      proc.kill()
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

export function getPowerStatus(): { isOnAC: boolean; isBlockerActive: boolean; isCaffeinateActive: boolean } {
  return { isOnAC, isBlockerActive: blockerId !== null, isCaffeinateActive: caffeinateProcess !== null }
}
