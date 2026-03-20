import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { TerminalScreen } from '../TerminalScreen'
import { injectJavaScriptMock } from '../../__mocks__/react-native-webview'
import { useLocalSearchParams, mockRouterBack } from '../../__mocks__/expo-router'

describe('TerminalScreen', () => {
  // WebView から onMessage を発火するヘルパー
  function sendFromWebView(msg: object) {
    const webViewEl = screen.getByTestId('webview')
    act(() => {
      webViewEl.props.onMessage({ nativeEvent: { data: JSON.stringify(msg) } })
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    injectJavaScriptMock.mockClear()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      ip: '100.64.0.1',
      token: 'test-token',
    })
  })

  it('WebView が render される', () => {
    render(<TerminalScreen />)
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('初期状態で「接続中...」ステータスが表示される', () => {
    render(<TerminalScreen />)
    expect(screen.getByText('接続中...')).toBeTruthy()
  })

  it('session_attached メッセージ → 「接続済み」ステータスに変わる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'session_attached', sessionId: 'test-session', scrollback: '' })
    expect(screen.getByText('接続済み')).toBeTruthy()
  })

  it('disconnected メッセージ → 「再接続中...」ステータスに変わる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'disconnected' })
    expect(screen.getByText('再接続中...')).toBeTruthy()
  })

  it('auth_error メッセージ → 「認証エラー」ステータスと「再試行」ボタンが表示される', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    expect(screen.getByText('認証エラー')).toBeTruthy()
    expect(screen.getByText('再試行')).toBeTruthy()
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('shell_exit メッセージ → 「セッション終了」ステータスと「再試行」ボタンが表示される', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'shell_exit', exitCode: 0 })
    expect(screen.getByText('セッション終了')).toBeTruthy()
    expect(screen.getByText('再試行')).toBeTruthy()
  })

  it('不正な JSON でも throw しない', () => {
    render(<TerminalScreen />)
    const webViewEl = screen.getByTestId('webview')
    expect(() => {
      act(() => {
        webViewEl.props.onMessage({ nativeEvent: { data: 'not-json' } })
      })
    }).not.toThrow()
  })

  it('source パラメータが不正な JSON でも throw しない', () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      ip: '100.64.0.1',
      token: 'test-token',
      source: 'invalid-json{',
    })
    expect(() => render(<TerminalScreen />)).not.toThrow()
  })

  it('切断ボタン押下で router.back() が呼ばれる', () => {
    render(<TerminalScreen />)
    fireEvent.press(screen.getByText('切断'))
    expect(mockRouterBack).toHaveBeenCalled()
  })

  it('再試行ボタン押下でステータスが「接続中...」に戻る', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    fireEvent.press(screen.getByText('再試行'))
    expect(screen.getByText('接続中...')).toBeTruthy()
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('session_not_found 受信後に auth_error ステータスになる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
    sendFromWebView({ type: 'session_not_found', sessionId: 'sid-gone' })

    expect(screen.getByText('認証エラー')).toBeTruthy()
  })

  describe('PermissionSheet', () => {
    it('permission_request を受信すると PermissionSheet が表示される', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-001',
        toolName: 'Bash',
        details: ['rm -rf /tmp/test'],
        requiresAlways: true,
      })

      expect(screen.getByText('承認リクエスト')).toBeTruthy()
      expect(screen.getByText('Bash')).toBeTruthy()
      expect(screen.getByText('rm -rf /tmp/test')).toBeTruthy()
      expect(screen.getByText('許可')).toBeTruthy()
      expect(screen.getByText('拒否')).toBeTruthy()
      expect(screen.getByText('常に許可')).toBeTruthy()
    })

    it('requiresAlways=false のとき「常に許可」ボタンが表示されない', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-002',
        toolName: 'Write',
        details: ['/tmp/file.ts'],
        requiresAlways: false,
      })

      expect(screen.getByText('許可')).toBeTruthy()
      expect(screen.getByText('拒否')).toBeTruthy()
      expect(screen.queryByText('常に許可')).toBeNull()
    })

    it('「許可」を押すと sendPermissionResponse が injectJavaScript で呼ばれ、シートが閉じる', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-003',
        toolName: 'Bash',
        details: [],
        requiresAlways: false,
      })

      fireEvent.press(screen.getByText('許可'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-003", "approve")'),
      )
      expect(screen.queryByText('承認リクエスト')).toBeNull()
    })

    it('「拒否」を押すと reject decision が送られ、シートが閉じる', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-004',
        toolName: 'Bash',
        details: [],
        requiresAlways: false,
      })

      fireEvent.press(screen.getByText('拒否'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-004", "reject")'),
      )
      expect(screen.queryByText('承認リクエスト')).toBeNull()
    })

    it('「常に許可」を押すと always decision が送られる', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-005',
        toolName: 'Bash',
        details: [],
        requiresAlways: true,
      })

      fireEvent.press(screen.getByText('常に許可'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-005", "always")'),
      )
    })
  })
})
