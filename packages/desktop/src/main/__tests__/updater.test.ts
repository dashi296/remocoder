import { describe, it, expect, vi, beforeEach } from 'vitest'

// electron と electron-updater をモックしてから updater を import する
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.3'),
  },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    quitAndInstall: vi.fn(),
  },
}))

// モック後に import（ホイスティング対策）
const { app } = await import('electron')
const { checkForUpdates, installUpdate } = await import('../updater')

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(app.getVersion).mockReturnValue('1.2.3')
  })

  describe('checkForUpdates', () => {
    it('autoUpdater.checkForUpdates を呼ぶ', async () => {
      const { autoUpdater } = await import('electron-updater')
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null as any)

      await checkForUpdates()

      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('checkForUpdates が reject した場合にエラーを伝播する', async () => {
      const { autoUpdater } = await import('electron-updater')
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('network error'))

      await expect(checkForUpdates()).rejects.toThrow('network error')
    })
  })

  describe('installUpdate', () => {
    it('autoUpdater.quitAndInstall を呼ぶ', async () => {
      const { autoUpdater } = await import('electron-updater')

      installUpdate()

      expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    })

    it('quitAndInstall が throw しても例外が外に漏れない', async () => {
      const { autoUpdater } = await import('electron-updater')
      vi.mocked(autoUpdater.quitAndInstall).mockImplementation(() => {
        throw new Error('not yet downloaded')
      })

      expect(() => installUpdate()).not.toThrow()
    })
  })
})
