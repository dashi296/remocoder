import React, { act } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import App from '../App'
import AsyncStorage from '../__mocks__/async-storage'

// useForceUpdate の fetch をモック（ネットワーク失敗 → isChecking: false になる）
;(globalThis as Record<string, unknown>).fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'))

// SessionPickerScreen が使う WebSocket をモック
const mockWs = {
  send: jest.fn(),
  close: jest.fn(),
  readyState: 0,
  onopen: null as (() => void) | null,
  onmessage: null as ((e: { data: string }) => void) | null,
  onerror: null as (() => void) | null,
  onclose: null as (() => void) | null,
}

;(globalThis as Record<string, unknown>).WebSocket = jest.fn().mockImplementation(() => mockWs)

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    AsyncStorage.clear()
    AsyncStorage.getItem.mockResolvedValue(null)
    mockWs.onopen = null
    mockWs.onmessage = null
    mockWs.onerror = null
    mockWs.onclose = null
  })

  it('初期画面: ConnectScreen が表示される', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('接続先がありません'))
    expect(screen.getByText('接続先がありません')).toBeTruthy()
  })

  it('接続後: SessionPickerScreen が表示される', async () => {
    const profiles = [{ id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    AsyncStorage.setItem.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))

    // SessionPickerScreen が表示される（「セッションを選択」ヘッダー）
    await waitFor(() => screen.getByText('セッションを選択'))
    expect(screen.getByText('セッションを選択')).toBeTruthy()
  })

  it('SessionPickerScreen の「戻る」でConnectScreenに戻る', async () => {
    const profiles = [{ id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    AsyncStorage.setItem.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))

    await waitFor(() => screen.getByText('← 戻る'))
    fireEvent.press(screen.getByText('← 戻る'))

    await waitFor(() => screen.getByText('MacBook'))
    expect(screen.getByText('MacBook')).toBeTruthy()
  })

  it('onSelectProject(path) → ChatScreen が projectPath 付きでレンダーされる', async () => {
    const profiles = [{ id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    AsyncStorage.setItem.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))

    await waitFor(() => screen.getByText('セッションを選択'))

    // auth_ok → project_list で接続完了
    act(() => { mockWs.onopen?.() })
    act(() => { mockWs.onmessage?.({ data: JSON.stringify({ type: 'auth_ok' }) }) })
    act(() => { mockWs.onmessage?.({ data: JSON.stringify({ type: 'session_list', sessions: [] }) }) })
    act(() => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'project_list',
          projects: [{ path: '/home/user/myapp', name: 'myapp', lastUsedAt: new Date().toISOString() }],
        }),
      })
    })

    await waitFor(() => screen.getByText('myapp'))
    fireEvent.press(screen.getByText('myapp'))

    // TerminalScreen に遷移し「接続中...」が表示される
    await waitFor(() => screen.getByText('接続中...'))
    expect(screen.getByText('接続中...')).toBeTruthy()
  })

  it('onAttachSession(sessionId) → source なし(claude扱い)なので ChatScreen が表示される', async () => {
    const profiles = [{ id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    AsyncStorage.setItem.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))

    await waitFor(() => screen.getByText('セッションを選択'))

    act(() => { mockWs.onopen?.() })
    act(() => { mockWs.onmessage?.({ data: JSON.stringify({ type: 'auth_ok' }) }) })
    act(() => {
      mockWs.onmessage?.({
        data: JSON.stringify({
          type: 'session_list',
          sessions: [
            { id: 'existing-sid', status: 'active', createdAt: new Date().toISOString(), projectPath: '/home/user/existing' },
          ],
        }),
      })
    })
    act(() => { mockWs.onmessage?.({ data: JSON.stringify({ type: 'project_list', projects: [] }) }) })

    await waitFor(() => screen.getByText('existing'))
    fireEvent.press(screen.getByText('existing'))

    // TerminalScreen に遷移
    await waitFor(() => screen.getByText('接続中...'))
    expect(screen.getByText('接続中...')).toBeTruthy()
  })
})
