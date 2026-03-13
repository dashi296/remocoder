import { describe, it, expect, vi, beforeEach } from 'vitest'

// electron と electron-updater をモックしてから updater を import する
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.3'),
  },
}))

const mockAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  quitAndInstall: vi.fn(),
}

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mockAutoUpdater },
  autoUpdater: mockAutoUpdater,
}))

// モック後に import（ホイスティング対策）
const { checkForUpdates, installUpdate } = await import('../updater')

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoUpdater.checkForUpdates.mockResolvedValue(null as any)
    mockAutoUpdater.quitAndInstall.mockReset()
  })

  describe('checkForUpdates', () => {
    it('autoUpdater.checkForUpdates を呼ぶ', async () => {
      await checkForUpdates()
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('checkForUpdates が reject した場合にエラーを伝播する', async () => {
      mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('network error'))
      await expect(checkForUpdates()).rejects.toThrow('network error')
    })
  })

  describe('installUpdate', () => {
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
})
