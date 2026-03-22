import { renderHook, waitFor } from '@testing-library/react-native'
import { Alert } from 'react-native'
import * as Updates from 'expo-updates'
import { useOTAUpdate } from '../hooks/useOTAUpdate'

const mockCheckForUpdateAsync = Updates.checkForUpdateAsync as jest.Mock
const mockFetchUpdateAsync = Updates.fetchUpdateAsync as jest.Mock
const mockReloadAsync = Updates.reloadAsync as jest.Mock
const mockAlert = Alert.alert as jest.Mock

describe('useOTAUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('__DEV__ が true のとき', () => {
    it('OTA チェックを実行しない', async () => {
      ;(globalThis as any).__DEV__ = true
      try {
        renderHook(() => useOTAUpdate())
        // 非同期処理が走らないことを確認
        await new Promise((r) => setTimeout(r, 0))
        expect(mockCheckForUpdateAsync).not.toHaveBeenCalled()
      } finally {
        delete (globalThis as any).__DEV__
      }
    })
  })

  describe('更新がないとき', () => {
    it('Alert を表示しない', async () => {
      mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: false })

      renderHook(() => useOTAUpdate())
      await waitFor(() => expect(mockCheckForUpdateAsync).toHaveBeenCalledTimes(1))

      expect(mockFetchUpdateAsync).not.toHaveBeenCalled()
      expect(mockAlert).not.toHaveBeenCalled()
    })
  })

  describe('更新があるとき', () => {
    it('fetchUpdateAsync を呼び Alert を表示する', async () => {
      mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: true })
      mockFetchUpdateAsync.mockResolvedValue(undefined)

      renderHook(() => useOTAUpdate())
      await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1))

      expect(mockFetchUpdateAsync).toHaveBeenCalledTimes(1)
      expect(mockAlert).toHaveBeenCalledWith(
        'Update Available',
        'Restart the app to apply the latest version?',
        expect.arrayContaining([
          expect.objectContaining({ text: 'Later' }),
          expect.objectContaining({ text: 'Restart' }),
        ]),
      )
    })

    it('再起動ボタンを押すと reloadAsync が呼ばれる', async () => {
      mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: true })
      mockFetchUpdateAsync.mockResolvedValue(undefined)

      renderHook(() => useOTAUpdate())
      await waitFor(() => expect(mockAlert).toHaveBeenCalledTimes(1))

      const buttons = mockAlert.mock.calls[0][2]
      const reloadButton = buttons.find((b: any) => b.text === 'Restart')
      reloadButton.onPress()

      expect(mockReloadAsync).toHaveBeenCalledTimes(1)
    })
  })

  describe('エラーが発生したとき', () => {
    it('例外をスローせず console.warn を呼ぶ', async () => {
      mockCheckForUpdateAsync.mockRejectedValue(new Error('network error'))
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        renderHook(() => useOTAUpdate())
        await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('useOTAUpdate'),
          expect.any(Error),
        )
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
