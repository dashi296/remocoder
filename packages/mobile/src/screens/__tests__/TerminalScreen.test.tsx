import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { TerminalScreen } from '../TerminalScreen'
import { injectJavaScriptMock } from '../../__mocks__/react-native-webview'
import { useLocalSearchParams, mockRouterBack } from '../../__mocks__/expo-router'
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight'

jest.mock('../../hooks/useKeyboardHeight', () => ({
  useKeyboardHeight: jest.fn(() => 0),
}))

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
    ;(useKeyboardHeight as jest.Mock).mockReturnValue(0)
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      ip: '100.64.0.1',
      token: 'test-token',
    })
  })

  it('WebView が render される', () => {
    render(<TerminalScreen />)
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('初期状態で「Connecting...」ステータスが表示される', () => {
    render(<TerminalScreen />)
    expect(screen.getByText('Connecting...')).toBeTruthy()
  })

  it('session_attached メッセージ → 「Connected」ステータスに変わる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'session_attached', sessionId: 'test-session', scrollback: '' })
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('disconnected メッセージ → 「Reconnecting...」ステータスに変わる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'disconnected' })
    expect(screen.getByText('Reconnecting...')).toBeTruthy()
  })

  it('auth_error メッセージ → 「Auth Error」ステータスと「Retry」ボタンが表示される', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    expect(screen.getByText('Auth Error')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('shell_exit メッセージ → 「Session Ended」ステータスと「Retry」ボタンが表示される', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'shell_exit', exitCode: 0 })
    expect(screen.getByText('Session Ended')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
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

  it('Disconnect ボタン押下で router.back() が呼ばれる', () => {
    render(<TerminalScreen />)
    fireEvent.press(screen.getByText('Disconnect'))
    expect(mockRouterBack).toHaveBeenCalled()
  })

  it('Retry ボタン押下でステータスが「Connecting...」に戻る', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    fireEvent.press(screen.getByText('Retry'))
    expect(screen.getByText('Connecting...')).toBeTruthy()
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('session_not_found 受信後に auth_error ステータスになる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
    sendFromWebView({ type: 'session_not_found', sessionId: 'sid-gone' })

    expect(screen.getByText('Auth Error')).toBeTruthy()
  })

  describe('PermissionSheet', () => {
    it('キーボード表示中でも PermissionSheet が表示される', () => {
      ;(useKeyboardHeight as jest.Mock).mockReturnValue(180)

      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-keyboard',
        toolName: 'Bash',
        details: ['echo hello'],
        requiresAlways: false,
        createdAt: Date.now(),
      })

      expect(screen.getByText('Permission Request')).toBeTruthy()
      expect(screen.getByText('Allow')).toBeTruthy()
    })

    it('permission_request を受信すると PermissionSheet が表示される', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-001',
        toolName: 'Bash',
        details: ['rm -rf /tmp/test'],
        requiresAlways: true,
      })

      expect(screen.getByText('Permission Request')).toBeTruthy()
      expect(screen.getByText('Bash')).toBeTruthy()
      expect(screen.getByText('rm -rf /tmp/test')).toBeTruthy()
      expect(screen.getByText('Allow')).toBeTruthy()
      expect(screen.getByText('Deny')).toBeTruthy()
      expect(screen.getByText('Always Allow')).toBeTruthy()
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

      expect(screen.getByText('Allow')).toBeTruthy()
      expect(screen.getByText('Deny')).toBeTruthy()
      expect(screen.queryByText('Always Allow')).toBeNull()
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

      fireEvent.press(screen.getByText('Allow'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-003", "approve")'),
      )
      expect(screen.queryByText('Permission Request')).toBeNull()
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

      fireEvent.press(screen.getByText('Deny'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-004", "reject")'),
      )
      expect(screen.queryByText('Permission Request')).toBeNull()
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

      fireEvent.press(screen.getByText('Always Allow'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-005", "always")'),
      )
    })
  })
})
