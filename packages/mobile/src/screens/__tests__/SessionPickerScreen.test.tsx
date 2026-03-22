import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionPickerScreen } from '../SessionPickerScreen'
import { useLocalSearchParams, mockRouterPush, mockRouterBack } from '../../__mocks__/expo-router'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.JSX.Element }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockWs = {
  send: jest.fn(),
  close: jest.fn(),
  readyState: 1,
  onopen: null as (() => void) | null,
  onmessage: null as ((e: { data: string }) => void) | null,
  onerror: null as (() => void) | null,
  onclose: null as (() => void) | null,
}

const MockWebSocket = Object.assign(
  jest.fn().mockImplementation(() => mockWs),
  { OPEN: 1 },
)
;(globalThis as Record<string, unknown>).WebSocket = MockWebSocket

function triggerOpen() {
  act(() => { mockWs.onopen?.() })
}

function triggerMessage(msg: object) {
  act(() => {
    mockWs.onmessage?.({ data: JSON.stringify(msg) })
  })
}

describe('SessionPickerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ ip: '100.64.0.1', token: 'test-token' })
    mockWs.send.mockClear()
    mockWs.close.mockClear()
    mockWs.onopen = null
    mockWs.onmessage = null
    mockWs.onerror = null
    mockWs.onclose = null
  })

  it('マウント時に「Connecting...」が表示される', () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    expect(screen.getByText('Connecting...')).toBeTruthy()
  })

  it('WebSocket を開いたとき auth メッセージを送信する', () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'auth', token: 'test-token' }),
    )
  })

  it('auth_ok 受信後に「接続中...」が消えセッション一覧が表示される', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({ type: 'project_list', projects: [] })
    triggerMessage({ type: 'session_list', sessions: [] })

    await waitFor(() => expect(screen.queryByText('Connecting...')).toBeNull())
    expect(screen.getByText('New Session')).toBeTruthy()
  })

  it('session_list を受信すると実行中セッションセクションが表示される', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({
      type: 'session_list',
      sessions: [
        { id: 'sid-1', status: 'active', createdAt: new Date().toISOString(), projectPath: '/home/user/myapp' },
      ],
    })
    triggerMessage({ type: 'project_list', projects: [] })

    await waitFor(() => expect(screen.getByText('Active Sessions')).toBeTruthy())
    expect(screen.getByText('myapp')).toBeTruthy()
  })

  it('project_list を受信すると「新規セッション」セクションにプロジェクトが表示される', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({ type: 'session_list', sessions: [] })
    triggerMessage({
      type: 'project_list',
      projects: [{ path: '/home/user/proj', name: 'proj', lastUsedAt: new Date().toISOString() }],
    })

    await waitFor(() => expect(screen.getByText('proj')).toBeTruthy())
  })

  it('セッション行をタップすると /terminal に sessionId で push ナビゲートする', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({
      type: 'session_list',
      sessions: [
        { id: 'sid-abc', status: 'active', createdAt: new Date().toISOString(), projectPath: '/home/user/myapp' },
      ],
    })
    triggerMessage({ type: 'project_list', projects: [] })

    await waitFor(() => expect(screen.getByText('myapp')).toBeTruthy())
    fireEvent.press(screen.getByText('myapp'))

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/terminal',
      params: expect.objectContaining({ sessionId: 'sid-abc' }),
    })
    expect(mockWs.close).toHaveBeenCalled()
  })

  it('「No project」をタップすると projectPath: "" で push ナビゲートする', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({ type: 'session_list', sessions: [] })
    triggerMessage({ type: 'project_list', projects: [] })

    await waitFor(() => expect(screen.getByText('No project')).toBeTruthy())
    fireEvent.press(screen.getByText('No project'))

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/terminal',
      params: expect.objectContaining({ projectPath: '' }),
    })
    expect(mockWs.close).toHaveBeenCalled()
  })

  it('プロジェクト行をタップすると projectPath で push ナビゲートする', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({ type: 'session_list', sessions: [] })
    triggerMessage({
      type: 'project_list',
      projects: [{ path: '/home/user/proj', name: 'proj', lastUsedAt: new Date().toISOString() }],
    })

    await waitFor(() => expect(screen.getByText('proj')).toBeTruthy())
    fireEvent.press(screen.getByText('proj'))

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/terminal',
      params: expect.objectContaining({ projectPath: '/home/user/proj' }),
    })
    expect(mockWs.close).toHaveBeenCalled()
  })

  it('auth_error 受信でエラー画面が表示される', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_error', reason: 'invalid token' })

    await waitFor(() => expect(screen.getByText('Connection error')).toBeTruthy())
  })

  it('接続済み状態でWSが切断されるとエラー画面が表示される', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({ type: 'session_list', sessions: [] })
    triggerMessage({ type: 'project_list', projects: [] })

    await waitFor(() => expect(screen.getByText('New Session')).toBeTruthy())

    act(() => { mockWs.onclose?.() })
    await waitFor(() => expect(screen.getByText('Connection error')).toBeTruthy())
  })

  it('選択後に WS が切断してもエラー画面にならない', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({ type: 'session_list', sessions: [] })
    triggerMessage({ type: 'project_list', projects: [] })

    await waitFor(() => expect(screen.getByText('No project')).toBeTruthy())
    fireEvent.press(screen.getByText('No project'))
    act(() => { mockWs.onclose?.() })

    expect(mockRouterPush).toHaveBeenCalled()
    expect(screen.queryByText('Connection error')).toBeNull()
  })

  it('ping 受信で pong を返す', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    mockWs.send.mockClear()
    triggerMessage({ type: 'ping' })

    expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
  })

  it('アンマウント時に WebSocket が閉じられる', () => {
    const { unmount } = render(<SessionPickerScreen />, { wrapper: createWrapper() })
    unmount()
    expect(mockWs.close).toHaveBeenCalled()
  })

  it('エラー画面の「戻る」ボタンで router.back() が呼ばれる', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_error', reason: 'invalid token' })

    await waitFor(() => expect(screen.getByText('Connection error')).toBeTruthy())
    fireEvent.press(screen.getByText('Back'))
    expect(mockRouterBack).toHaveBeenCalled()
  })

  it('セッションのステータスが active のとき「アクティブ」と表示される', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({
      type: 'session_list',
      sessions: [
        { id: 'sid-1', status: 'active', createdAt: new Date().toISOString() },
      ],
    })
    triggerMessage({ type: 'project_list', projects: [] })

    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy())
  })

  it('セッションの hasClient が true のとき「· 接続中」と表示される', async () => {
    render(<SessionPickerScreen />, { wrapper: createWrapper() })
    triggerOpen()
    triggerMessage({ type: 'auth_ok' })
    triggerMessage({
      type: 'session_list',
      sessions: [
        { id: 'sid-1', status: 'active', createdAt: new Date().toISOString(), hasClient: true },
      ],
    })
    triggerMessage({ type: 'project_list', projects: [] })

    await waitFor(() => expect(screen.getByText('Active · Connected')).toBeTruthy())
  })

  describe('セッション削除', () => {
    const { Alert } = require('react-native')
    const session = { id: 'sid-del', status: 'active' as const, createdAt: new Date().toISOString(), projectPath: '/home/user/app' }

    async function renderWithSession() {
      render(<SessionPickerScreen />, { wrapper: createWrapper() })
      triggerOpen()
      triggerMessage({ type: 'auth_ok' })
      triggerMessage({ type: 'session_list', sessions: [session] })
      triggerMessage({ type: 'project_list', projects: [] })
      await waitFor(() => expect(screen.getByText('app')).toBeTruthy())
    }

    function confirmDelete() {
      // Alert.alert に渡されたボタン定義から「削除」ボタンの onPress を呼ぶ
      const [, , buttons] = Alert.alert.mock.lastCall
      buttons.find((b: { text: string; onPress?: () => void }) => b.text === 'Delete')?.onPress?.()
    }

    it('ロングプレスで Alert が表示され、確認すると session_delete を送信する', async () => {
      await renderWithSession()
      fireEvent(screen.getByText('app'), 'longPress')

      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete Session',
        expect.stringContaining('app'),
        expect.any(Array),
      )

      act(() => confirmDelete())

      await waitFor(() =>
        expect(mockWs.send).toHaveBeenCalledWith(
          JSON.stringify({ type: 'session_delete', sessionId: 'sid-del' }),
        ),
      )
    })

    it('session_deleted 受信でセッション行がリストから消える', async () => {
      await renderWithSession()
      fireEvent(screen.getByText('app'), 'longPress')
      act(() => confirmDelete())

      triggerMessage({ type: 'session_deleted', sessionId: 'sid-del' })

      await waitFor(() => expect(screen.queryByText('app')).toBeNull(), { timeout: 5000 })
    })

    it('キャンセルを選ぶと session_delete は送信されない', async () => {
      await renderWithSession()
      mockWs.send.mockClear()
      fireEvent(screen.getByText('app'), 'longPress')

      // キャンセルボタンの onPress は undefined（style: 'cancel'）なので送信されない
      const [, , buttons] = Alert.alert.mock.lastCall
      buttons.find((b: { text: string; onPress?: () => void }) => b.text === 'Cancel')?.onPress?.()

      expect(mockWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('session_delete'),
      )
    })
  })
})
