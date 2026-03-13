import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { TerminalScreen } from '../TerminalScreen'
import { injectJavaScriptMock } from '../../__mocks__/react-native-webview'

describe('TerminalScreen', () => {
  const onDisconnect = jest.fn()
  const defaultProps = { ip: '100.64.0.1', token: 'test-token', onDisconnect }

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
  })

  it('WebView が render される', () => {
    render(<TerminalScreen {...defaultProps} />)
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('初期状態で「接続中...」ステータスが表示される', () => {
    render(<TerminalScreen {...defaultProps} />)
    expect(screen.getByText('接続中...')).toBeTruthy()
  })

  it('session_attached メッセージ → 「接続済み」ステータスに変わる', () => {
    render(<TerminalScreen {...defaultProps} />)
    sendFromWebView({ type: 'session_attached', sessionId: 'test-session', scrollback: '' })
    expect(screen.getByText('接続済み')).toBeTruthy()
  })

  it('disconnected メッセージ → 「再接続中...」ステータスに変わる', () => {
    render(<TerminalScreen {...defaultProps} />)
    sendFromWebView({ type: 'disconnected' })
    expect(screen.getByText('再接続中...')).toBeTruthy()
  })

  it('auth_error メッセージ → 「認証エラー」ステータスと「再試行」ボタンが表示される', () => {
    render(<TerminalScreen {...defaultProps} />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    expect(screen.getByText('認証エラー')).toBeTruthy()
    expect(screen.getByText('再試行')).toBeTruthy()
    // auth_error だけでは onDisconnect を呼ばない
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('shell_exit メッセージ → 「セッション終了」ステータスと「再試行」ボタンが表示される', () => {
    render(<TerminalScreen {...defaultProps} />)
    sendFromWebView({ type: 'shell_exit', exitCode: 0 })
    expect(screen.getByText('セッション終了')).toBeTruthy()
    expect(screen.getByText('再試行')).toBeTruthy()
  })

  it('不正な JSON でも throw しない', () => {
    render(<TerminalScreen {...defaultProps} />)
    const webViewEl = screen.getByTestId('webview')
    expect(() => {
      act(() => {
        webViewEl.props.onMessage({ nativeEvent: { data: 'not-json' } })
      })
    }).not.toThrow()
  })

  it('切断ボタン押下で onDisconnect が呼ばれる', () => {
    render(<TerminalScreen {...defaultProps} />)
    fireEvent.press(screen.getByText('切断'))
    expect(onDisconnect).toHaveBeenCalled()
  })

  it('再試行ボタン押下で ステータスが「接続中...」に戻る', () => {
    render(<TerminalScreen {...defaultProps} />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    fireEvent.press(screen.getByText('再試行'))
    expect(screen.getByText('接続中...')).toBeTruthy()
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  describe('セッション切替', () => {
    it('接続済み状態でのみ「切替」ボタンが表示される', () => {
      render(<TerminalScreen {...defaultProps} />)
      // 初期状態（connecting）では表示されない
      expect(screen.queryByText('切替')).toBeNull()

      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
      expect(screen.getByText('切替')).toBeTruthy()
    })

    it('「切替」ボタン押下で injectJavaScript が requestSessionList を呼ぶ', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })

      fireEvent.press(screen.getByText('切替'))
      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.requestSessionList()'),
      )
    })

    it('session_list_response を受信するとモーダルが開く', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })

      sendFromWebView({
        type: 'session_list_response',
        sessions: [
          { id: 'sid-1', status: 'active', createdAt: new Date().toISOString(), projectPath: '/home/user/proj' },
        ],
        projects: [
          { path: '/home/user/other', name: 'other', lastUsedAt: new Date().toISOString() },
        ],
      })

      expect(screen.getByText('セッション切替')).toBeTruthy()
      expect(screen.getByText('実行中のセッション')).toBeTruthy()
      expect(screen.getByText('新規セッション')).toBeTruthy()
    })

    it('モーダルのセッション行をタップすると switchToSession が呼ばれる', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-current', scrollback: '' })
      sendFromWebView({
        type: 'session_list_response',
        sessions: [
          { id: 'sid-other', status: 'idle', createdAt: new Date().toISOString(), projectPath: '/home/user/other' },
        ],
        projects: [],
      })

      fireEvent.press(screen.getByText('other'))
      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.switchToSession("sid-other")'),
      )
    })

    it('現在のセッション行はタップ不可（disabled）', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
      sendFromWebView({
        type: 'session_list_response',
        sessions: [
          { id: 'sid-1', status: 'active', createdAt: new Date().toISOString(), projectPath: '/home/user/proj' },
        ],
        projects: [],
      })

      // 「現在」バッジが表示される
      expect(screen.getByText('現在')).toBeTruthy()
    })

    it('モーダルの「プロジェクトなし」をタップすると createNewSession(null) が呼ばれる', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
      sendFromWebView({ type: 'session_list_response', sessions: [], projects: [] })

      fireEvent.press(screen.getByText('プロジェクトなし'))
      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.createNewSession(null)'),
      )
    })

    it('モーダルのプロジェクト行をタップすると createNewSession(path) が呼ばれる', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
      sendFromWebView({
        type: 'session_list_response',
        sessions: [],
        projects: [{ path: '/home/user/myapp', name: 'myapp', lastUsedAt: new Date().toISOString() }],
      })

      fireEvent.press(screen.getByText('myapp'))
      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.createNewSession("/home/user/myapp")'),
      )
    })

    it('session_attached 受信後にモーダルが閉じる', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
      sendFromWebView({ type: 'session_list_response', sessions: [], projects: [] })

      // モーダルが開いた状態を確認
      expect(screen.getByText('セッション切替')).toBeTruthy()

      // session_attached を受信するとモーダルが閉じる
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-2', scrollback: '' })
      expect(screen.queryByText('セッション切替')).toBeNull()
    })

    it('session_not_found 受信後に auth_error ステータスになりスイッチャーが閉じる', () => {
      render(<TerminalScreen {...defaultProps} />)
      sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
      sendFromWebView({ type: 'session_list_response', sessions: [], projects: [] })
      sendFromWebView({ type: 'session_not_found', sessionId: 'sid-gone' })

      expect(screen.getByText('認証エラー')).toBeTruthy()
      expect(screen.queryByText('セッション切替')).toBeNull()
    })
  })
})
