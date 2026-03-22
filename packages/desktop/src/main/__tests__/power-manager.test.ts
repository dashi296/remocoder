// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock references ──────────────────────────────────────────────────
const mockGetPath = vi.hoisted(() => vi.fn(() => '/mock/userData'))
const mockIsOnBatteryPower = vi.hoisted(() => vi.fn(() => false))
const mockPowerMonitorOn = vi.hoisted(() => vi.fn())
const mockBlockerStart = vi.hoisted(() => vi.fn(() => 99))
const mockBlockerStop = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())
const mockWriteFileSync = vi.hoisted(() => vi.fn())

// caffeinate プロセスのモック
const mockCaffeinateKill = vi.hoisted(() => vi.fn())
const mockCaffeinateOn = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() =>
  vi.fn(() => ({ pid: 1234, kill: mockCaffeinateKill, on: mockCaffeinateOn })),
)

vi.mock('electron', () => ({
  app: { getPath: mockGetPath },
  powerMonitor: {
    isOnBatteryPower: mockIsOnBatteryPower,
    on: mockPowerMonitorOn,
  },
  powerSaveBlocker: {
    start: mockBlockerStart,
    stop: mockBlockerStop,
  },
}))

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}))

vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
}))

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockWindow() {
  const windowHandlers: Record<string, () => void> = {}
  return {
    webContents: { send: vi.fn() },
    on: vi.fn((event: string, cb: () => void) => {
      windowHandlers[event] = cb
    }),
    _emit: (event: string) => windowHandlers[event]?.(),
  }
}

/** initPowerManager 後に powerMonitor.on で登録されたハンドラを取得する */
function capturePowerHandlers(): Record<string, () => void> {
  const handlers: Record<string, () => void> = {}
  for (const [event, cb] of mockPowerMonitorOn.mock.calls as [string, () => void][]) {
    handlers[event] = cb
  }
  return handlers
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('power-manager', () => {
  beforeEach(() => {
    vi.resetModules()
    mockIsOnBatteryPower.mockReturnValue(false) // デフォルト: AC電源
    mockReadFileSync.mockImplementation(() => {
      throw new Error('no file')
    })
    mockBlockerStart.mockReturnValue(99)
    mockBlockerStart.mockClear()
    mockBlockerStop.mockClear()
    mockWriteFileSync.mockClear()
    mockPowerMonitorOn.mockClear()
    mockSpawn.mockClear()
    mockCaffeinateKill.mockClear()
    mockCaffeinateOn.mockClear()
    // spawn が返すモックオブジェクトをリセット
    mockSpawn.mockReturnValue({ pid: 1234, kill: mockCaffeinateKill, on: mockCaffeinateOn })
  })

  // ── getPowerSettings ───────────────────────────────────────────────────────

  describe('getPowerSettings', () => {
    it('initPowerManager 前はデフォルト設定を返す', async () => {
      const { getPowerSettings } = await import('../power-manager')
      expect(getPowerSettings()).toEqual({ preventSleepOnAC: false, preventSleepOnBattery: false, preventLidSleep: false })
    })

    it('正常なファイルから設定を読み込む', async () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ preventSleepOnAC: true, preventSleepOnBattery: false, preventLidSleep: true }),
      )
      const { initPowerManager, getPowerSettings } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      expect(getPowerSettings()).toEqual({ preventSleepOnAC: true, preventSleepOnBattery: false, preventLidSleep: true })
    })

    it('preventLidSleep なしの旧ファイル → preventLidSleep=false にフォールバックする', async () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ preventSleepOnAC: true, preventSleepOnBattery: false }),
      )
      const { initPowerManager, getPowerSettings } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      expect(getPowerSettings()).toEqual({ preventSleepOnAC: true, preventSleepOnBattery: false, preventLidSleep: false })
    })

    it('不正な JSON → デフォルト設定を返す', async () => {
      mockReadFileSync.mockReturnValue('invalid{json')
      const { initPowerManager, getPowerSettings } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      expect(getPowerSettings()).toEqual({ preventSleepOnAC: false, preventSleepOnBattery: false, preventLidSleep: false })
    })

    it('型が不正な設定 → デフォルト設定を返す', async () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ preventSleepOnAC: 'yes', preventSleepOnBattery: 1 }),
      )
      const { initPowerManager, getPowerSettings } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      expect(getPowerSettings()).toEqual({ preventSleepOnAC: false, preventSleepOnBattery: false, preventLidSleep: false })
    })

    it('設定ファイルのパスに userData を使用する', async () => {
      const { initPowerManager } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      expect(mockGetPath).toHaveBeenCalledWith('userData')
    })
  })

  // ── getPowerStatus ─────────────────────────────────────────────────────────

  describe('getPowerStatus', () => {
    it('初期状態: AC電源・ブロッカー非アクティブ', async () => {
      const { getPowerStatus } = await import('../power-manager')
      expect(getPowerStatus()).toEqual({ isOnAC: true, isBlockerActive: false, isCaffeinateActive: false })
    })

    it('initPowerManager でバッテリー状態を反映する', async () => {
      mockIsOnBatteryPower.mockReturnValue(true)
      const { initPowerManager, getPowerStatus } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      expect(getPowerStatus()).toEqual({ isOnAC: false, isBlockerActive: false, isCaffeinateActive: false })
    })

    it('ブロッカー起動後は isBlockerActive=true', async () => {
      const { initPowerManager, setPowerSetting, getPowerStatus } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnAC', true)
      expect(getPowerStatus().isBlockerActive).toBe(true)
    })
  })

  // ── setPowerSetting ────────────────────────────────────────────────────────

  describe('setPowerSetting', () => {
    it('設定を更新して正しいパスに永続化する', async () => {
      const { setPowerSetting, getPowerSettings } = await import('../power-manager')
      setPowerSetting('preventSleepOnBattery', true)
      expect(getPowerSettings()).toEqual({ preventSleepOnAC: false, preventSleepOnBattery: true, preventLidSleep: false })
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/mock/userData/power-settings.json',
        JSON.stringify({ preventSleepOnAC: false, preventSleepOnBattery: true, preventLidSleep: false }),
        'utf-8',
      )
    })

    it('元の設定オブジェクトを変更しない（イミュータブル）', async () => {
      const { getPowerSettings, setPowerSetting } = await import('../power-manager')
      const before = getPowerSettings()
      setPowerSetting('preventSleepOnAC', true)
      expect(before.preventSleepOnAC).toBe(false)
    })
  })

  // ── applyBlocker ───────────────────────────────────────────────────────────

  describe('applyBlocker', () => {
    it('AC電源 + preventSleepOnAC=true → ブロッカー開始', async () => {
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnAC', true)
      expect(mockBlockerStart).toHaveBeenCalledWith('prevent-display-sleep')
    })

    it('AC電源 + preventSleepOnAC=false → ブロッカー開始しない', async () => {
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnAC', false)
      expect(mockBlockerStart).not.toHaveBeenCalled()
    })

    it('AC電源 + preventSleepOnBattery=true → ブロッカー開始しない', async () => {
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnBattery', true)
      expect(mockBlockerStart).not.toHaveBeenCalled()
    })

    it('バッテリー + preventSleepOnBattery=true → ブロッカー開始', async () => {
      mockIsOnBatteryPower.mockReturnValue(true)
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnBattery', true)
      expect(mockBlockerStart).toHaveBeenCalledWith('prevent-display-sleep')
    })

    it('バッテリー + preventSleepOnAC=true → ブロッカー開始しない', async () => {
      mockIsOnBatteryPower.mockReturnValue(true)
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnAC', true)
      expect(mockBlockerStart).not.toHaveBeenCalled()
    })

    it('ブロッカー起動中に shouldBlock=false → 停止する（冪等）', async () => {
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnAC', true) // start
      expect(mockBlockerStart).toHaveBeenCalledTimes(1)
      setPowerSetting('preventSleepOnAC', false) // stop
      expect(mockBlockerStop).toHaveBeenCalledWith(99)
    })

    it('ブロッカー停止中に shouldBlock=false → stop を呼ばない（冪等）', async () => {
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnAC', false)
      expect(mockBlockerStop).not.toHaveBeenCalled()
    })

    it('ブロッカー起動中に再度 shouldBlock=true → 二重起動しない', async () => {
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventSleepOnAC', true)
      setPowerSetting('preventSleepOnAC', true) // 2回目
      expect(mockBlockerStart).toHaveBeenCalledTimes(1)
    })
  })

  // ── powerMonitor イベント ──────────────────────────────────────────────────

  describe('powerMonitor イベント', () => {
    it('on-ac イベント → isOnAC=true になりレンダラーに通知する', async () => {
      mockIsOnBatteryPower.mockReturnValue(true) // バッテリー状態で起動
      const { initPowerManager, getPowerStatus } = await import('../power-manager')
      const win = createMockWindow() as any
      initPowerManager(win)
      const handlers = capturePowerHandlers()

      handlers['on-ac']()

      expect(getPowerStatus().isOnAC).toBe(true)
      expect(win.webContents.send).toHaveBeenCalledWith('power-status-changed', {
        isOnAC: true,
        isBlockerActive: false,
        isCaffeinateActive: false,
      })
    })

    it('on-battery イベント → isOnAC=false になりレンダラーに通知する', async () => {
      const { initPowerManager, getPowerStatus } = await import('../power-manager')
      const win = createMockWindow() as any
      initPowerManager(win)
      const handlers = capturePowerHandlers()

      handlers['on-battery']()

      expect(getPowerStatus().isOnAC).toBe(false)
      expect(win.webContents.send).toHaveBeenCalledWith('power-status-changed', {
        isOnAC: false,
        isBlockerActive: false,
        isCaffeinateActive: false,
      })
    })

    it('on-ac イベント + preventSleepOnAC=true → ブロッカー起動してレンダラーに通知', async () => {
      mockIsOnBatteryPower.mockReturnValue(true) // バッテリー状態で起動
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      const win = createMockWindow() as any
      initPowerManager(win)
      setPowerSetting('preventSleepOnAC', true)
      const handlers = capturePowerHandlers()

      handlers['on-ac']()

      expect(mockBlockerStart).toHaveBeenCalledWith('prevent-display-sleep')
      expect(win.webContents.send).toHaveBeenLastCalledWith('power-status-changed', {
        isOnAC: true,
        isBlockerActive: true,
        isCaffeinateActive: false,
      })
    })

    it('on-battery イベント + preventSleepOnBattery=false → ブロッカー停止', async () => {
      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      const win = createMockWindow() as any
      initPowerManager(win)
      setPowerSetting('preventSleepOnAC', true) // AC時にブロッカー起動
      const handlers = capturePowerHandlers()

      handlers['on-battery']() // バッテリーに切り替え → preventSleepOnBattery=false なので停止

      expect(mockBlockerStop).toHaveBeenCalledWith(99)
    })
  })

  // ── ウィンドウ closed ──────────────────────────────────────────────────────

  describe('ウィンドウ closed イベント', () => {
    it('ブロッカー起動中にウィンドウが閉じられる → 停止する', async () => {
      const { initPowerManager, setPowerSetting, getPowerStatus } = await import('../power-manager')
      const win = createMockWindow() as any
      initPowerManager(win)
      setPowerSetting('preventSleepOnAC', true)

      win._emit('closed')

      expect(mockBlockerStop).toHaveBeenCalledWith(99)
      expect(getPowerStatus().isBlockerActive).toBe(false)
    })

    it('ブロッカー停止中にウィンドウが閉じられる → stop を呼ばない', async () => {
      const { initPowerManager } = await import('../power-manager')
      const win = createMockWindow() as any
      initPowerManager(win)

      win._emit('closed')

      expect(mockBlockerStop).not.toHaveBeenCalled()
    })

    it('caffeinate 起動中にウィンドウが閉じられる → caffeinate を kill する', async () => {
      vi.stubEnv('VITEST_PLATFORM', 'darwin')
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      const win = createMockWindow() as any
      initPowerManager(win)
      setPowerSetting('preventLidSleep', true)
      expect(mockSpawn).toHaveBeenCalledWith('caffeinate', ['-s', '-i'], expect.any(Object))

      win._emit('closed')

      expect(mockCaffeinateKill).toHaveBeenCalled()
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })
  })

  // ── caffeinate (preventLidSleep) ──────────────────────────────────────────

  describe('caffeinate (preventLidSleep)', () => {
    it('macOS + preventLidSleep=true → caffeinate を起動する', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventLidSleep', true)

      expect(mockSpawn).toHaveBeenCalledWith('caffeinate', ['-s', '-i'], expect.any(Object))
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('macOS + preventLidSleep=false → caffeinate を起動しない', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventLidSleep', false)

      expect(mockSpawn).not.toHaveBeenCalled()
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('非macOS + preventLidSleep=true → caffeinate を起動しない', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventLidSleep', true)

      expect(mockSpawn).not.toHaveBeenCalled()
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('caffeinate 起動中に preventLidSleep=false → kill する', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventLidSleep', true)  // start
      setPowerSetting('preventLidSleep', false) // stop

      expect(mockCaffeinateKill).toHaveBeenCalledTimes(1)
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('caffeinate 起動中に再度 preventLidSleep=true → 二重起動しない', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      const { initPowerManager, setPowerSetting } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventLidSleep', true)
      setPowerSetting('preventLidSleep', true) // 2回目

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('isCaffeinateActive は caffeinate 起動中に true を返す', async () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      const { initPowerManager, setPowerSetting, getPowerStatus } = await import('../power-manager')
      initPowerManager(createMockWindow() as any)
      setPowerSetting('preventLidSleep', true)

      expect(getPowerStatus().isCaffeinateActive).toBe(true)
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })
  })
})
