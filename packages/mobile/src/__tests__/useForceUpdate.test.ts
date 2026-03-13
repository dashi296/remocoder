import { renderHook, waitFor } from '@testing-library/react-native'
import { useForceUpdate } from '../hooks/useForceUpdate'
import Constants from 'expo-constants'

const mockFetch = jest.fn()
;(globalThis as Record<string, unknown>).fetch = mockFetch

const makeConfig = (minimumNativeVersion: string) => ({
  schemaVersion: 1,
  mobile: {
    minimumNativeVersion,
    latestVersion: '2.0.0',
    forceUpdateMessage: 'テスト用アップデートメッセージ',
    storeUrls: {
      ios: 'https://apps.apple.com/app/remocoder/id000000000',
      android: 'https://play.google.com/store/apps/details?id=com.remocoder.app',
    },
  },
  desktop: { minimumVersion: '0.0.1', latestVersion: '0.0.1' },
  compatibility: {
    minimumDesktopVersionForMobile: '0.0.1',
    minimumMobileVersionForDesktop: '0.0.1',
  },
})

function mockFetchResponse(config: object) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(config),
  })
}

describe('useForceUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Constants.expoConfig = { version: '1.0.0' } as any
  })

  it('isChecking が初期状態で true', () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // 未解決
    const { result } = renderHook(() => useForceUpdate())
    expect(result.current.isChecking).toBe(true)
    expect(result.current.needsUpdate).toBe(false)
  })

  it('アプリバージョンが minimumNativeVersion 以上なら needsUpdate = false', async () => {
    Constants.expoConfig = { version: '1.0.0' } as any
    mockFetchResponse(makeConfig('1.0.0'))

    const { result } = renderHook(() => useForceUpdate())
    await waitFor(() => expect(result.current.isChecking).toBe(false))

    expect(result.current.needsUpdate).toBe(false)
  })

  it('アプリバージョンが minimumNativeVersion より古ければ needsUpdate = true', async () => {
    Constants.expoConfig = { version: '0.9.0' } as any
    mockFetchResponse(makeConfig('1.0.0'))

    const { result } = renderHook(() => useForceUpdate())
    await waitFor(() => expect(result.current.isChecking).toBe(false))

    expect(result.current.needsUpdate).toBe(true)
    expect(result.current.message).toBe('テスト用アップデートメッセージ')
  })

  it('ネットワークエラー時は needsUpdate = false でスキップ', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network Error'))

    const { result } = renderHook(() => useForceUpdate())
    await waitFor(() => expect(result.current.isChecking).toBe(false))

    expect(result.current.needsUpdate).toBe(false)
  })

  it('HTTP エラー時は needsUpdate = false でスキップ', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    const { result } = renderHook(() => useForceUpdate())
    await waitFor(() => expect(result.current.isChecking).toBe(false))

    expect(result.current.needsUpdate).toBe(false)
  })

  it('iOS では storeUrls.ios を返す', async () => {
    Constants.expoConfig = { version: '0.5.0' } as any
    mockFetchResponse(makeConfig('1.0.0'))

    const { result } = renderHook(() => useForceUpdate())
    await waitFor(() => expect(result.current.isChecking).toBe(false))

    // jest の Platform.OS は 'ios'（__mocks__/react-native.ts で設定）
    expect(result.current.storeUrl).toBe('https://apps.apple.com/app/remocoder/id000000000')
  })
})
