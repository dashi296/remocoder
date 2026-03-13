import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// electron と electron-updater をモックしてから updater を import する
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.3'),
    isPackaged: false,
  },
}))

const mockAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  quitAndInstall: vi.fn(),
  downloadUpdate: vi.fn(() => Promise.resolve()),
}

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mockAutoUpdater },
  autoUpdater: mockAutoUpdater,
}))

// モック後に import（ホイスティング対策）
const { checkForUpdates, downloadUpdate, installUpdate, setupAutoUpdater } = await import('../updater')

// ── setupAutoUpdater のテスト ──────────────────────────────────────────────────

describe('setupAutoUpdater', () => {
  const mockSend = vi.fn()
  const mockWinOn = vi.fn()
  const mockWin = {
    webContents: { send: mockSend },
    on: mockWinOn,
  }

  // イベントハンドラーを取得するヘルパー
  function capturedHandler(event: string): (...args: unknown[]) => void {
    const call = mockAutoUpdater.on.mock.calls.find((c) => c[0] === event)
    if (!call) throw new Error(`handler for '${event}' not registered`)
    return call[1] as (...args: unknown[]) => void
  }

  beforeAll(() => {
    vi.clearAllMocks()
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null as any)
    setupAutoUpdater(mockWin as any)
  })

  it('各イベントハンドラーを登録する', () => {
    const registeredEvents = mockAutoUpdater.on.mock.calls.map((c) => c[0])
    expect(registeredEvents).toContain('update-available')
    expect(registeredEvents).toContain('update-downloaded')
    expect(registeredEvents).toContain('error')
  })

  it('二重初期化を防止する（2回目の呼び出しでイベントが再登録されない）', () => {
    const countBefore = mockAutoUpdater.on.mock.calls.length
    setupAutoUpdater(mockWin as any)
    expect(mockAutoUpdater.on.mock.calls.length).toBe(countBefore)
  })

  describe('update-available ハンドラー', () => {
    beforeEach(() => mockSend.mockClear())

    it('Minor バージョンで update-available を送信し自動ダウンロードを開始する', () => {
      const handler = capturedHandler('update-available')
      handler({ version: '1.3.0' })

      expect(mockSend).toHaveBeenCalledWith('update-available', {
        version: '1.3.0',
        isMajor: false,
      })
      expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalled()
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
    })

    it('Major バージョンで update-available を送信するが自動ダウンロードしない', () => {
      mockAutoUpdater.downloadUpdate.mockClear()
      mockAutoUpdater.autoInstallOnAppQuit = false
      const handler = capturedHandler('update-available')
      handler({ version: '2.0.0' })

      expect(mockSend).toHaveBeenCalledWith('update-available', {
        version: '2.0.0',
        isMajor: true,
      })
      expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(false)
    })
  })

  describe('update-downloaded ハンドラー', () => {
    beforeEach(() => mockSend.mockClear())

    it('update-downloaded を renderer に送信する', () => {
      const handler = capturedHandler('update-downloaded')
      handler({ version: '1.3.0' })

      expect(mockSend).toHaveBeenCalledWith('update-downloaded', {
        version: '1.3.0',
        isMajor: false,
      })
    })
  })

  describe('error ハンドラー', () => {
    beforeEach(() => mockSend.mockClear())

    it('本番エラーを renderer に送信する', () => {
      const handler = capturedHandler('error')
      // isPackaged=true をシミュレート（開発環境フィルタに引っかからないエラー）
      handler(new Error('network timeout'))

      expect(mockSend).toHaveBeenCalledWith('update-error', { message: 'network timeout' })
    })

    it('開発環境の "No published versions" エラーを握り潰す', () => {
      const handler = capturedHandler('error')
      handler(new Error('No published versions on GitHub'))

      expect(mockSend).not.toHaveBeenCalled()
    })

    it('開発環境の "net::ERR_FILE_NOT_FOUND" エラーを握り潰す', () => {
      const handler = capturedHandler('error')
      handler(new Error('net::ERR_FILE_NOT_FOUND'))

      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe('win.closed ハンドラー', () => {
    it('closed イベントのハンドラーを登録する', () => {
      expect(mockWinOn).toHaveBeenCalledWith('closed', expect.any(Function))
    })
  })
})

// ── checkForUpdates のテスト ──────────────────────────────────────────────────

describe('checkForUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null as any)
  })

  it('autoUpdater.checkForUpdates を呼ぶ', async () => {
    await checkForUpdates()
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('checkForUpdates が reject した場合にエラーを伝播する', async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('network error'))
    await expect(checkForUpdates()).rejects.toThrow('network error')
  })
})

// ── downloadUpdate のテスト ────────────────────────────────────────────────────

describe('downloadUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoUpdater.downloadUpdate.mockResolvedValue(undefined)
    mockAutoUpdater.autoInstallOnAppQuit = false
  })

  it('autoUpdater.downloadUpdate を呼び autoInstallOnAppQuit を true に設定する', () => {
    downloadUpdate()
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })
})

// ── installUpdate のテスト ─────────────────────────────────────────────────────

describe('installUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoUpdater.quitAndInstall.mockReset()
  })

  it('autoUpdater.quitAndInstall を呼ぶ', () => {
    installUpdate()
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('quitAndInstall が throw しても例外が外に漏れない', () => {
    mockAutoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('not yet downloaded')
    })
    expect(() => installUpdate()).not.toThrow()
  })
})
