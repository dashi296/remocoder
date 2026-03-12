import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { TerminalScreen } from '../TerminalScreen'
import { WebView } from '../../__mocks__/react-native-webview'

describe('TerminalScreen', () => {
  const onDisconnect = jest.fn()
  const defaultProps = { ip: '100.64.0.1', token: 'test-token', onDisconnect }

  beforeEach(() => {
    jest.clearAllMocks()
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
    const webViewEl = screen.UNSAFE_getByType(WebView)
    act(() => {
      webViewEl.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({ type: 'session_attached', sessionId: 'test-session', scrollback: '' }),
        },
      })
    })
    expect(screen.getByText('接続済み')).toBeTruthy()
  })

  it('disconnected メッセージ → 「再接続中...」ステータスに変わる', () => {
    render(<TerminalScreen {...defaultProps} />)
    const webViewEl = screen.UNSAFE_getByType(WebView)
    act(() => {
      webViewEl.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'disconnected' }) },
      })
    })
    expect(screen.getByText('再接続中...')).toBeTruthy()
  })

  it('auth_error メッセージ → 「認証エラー」ステータスと「再試行」ボタンが表示される', () => {
    render(<TerminalScreen {...defaultProps} />)
    const webViewEl = screen.UNSAFE_getByType(WebView)
    act(() => {
      webViewEl.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'auth_error', reason: 'invalid token' }) },
      })
    })
    expect(screen.getByText('認証エラー')).toBeTruthy()
    expect(screen.getByText('再試行')).toBeTruthy()
    // auth_error だけでは onDisconnect を呼ばない
    expect(onDisconnect).not.toHaveBeenCalled()
  })

  it('shell_exit メッセージ → 「セッション終了」ステータスと「再試行」ボタンが表示される', () => {
    render(<TerminalScreen {...defaultProps} />)
    const webViewEl = screen.UNSAFE_getByType(WebView)
    act(() => {
      webViewEl.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'shell_exit', exitCode: 0 }) },
      })
    })
    expect(screen.getByText('セッション終了')).toBeTruthy()
    expect(screen.getByText('再試行')).toBeTruthy()
  })

  it('不正な JSON でも throw しない', () => {
    render(<TerminalScreen {...defaultProps} />)
    const webViewEl = screen.UNSAFE_getByType(WebView)
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
    const webViewEl = screen.UNSAFE_getByType(WebView)
    act(() => {
      webViewEl.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'auth_error', reason: 'invalid token' }) },
      })
    })
    fireEvent.press(screen.getByText('再試行'))
    expect(screen.getByText('接続中...')).toBeTruthy()
    expect(onDisconnect).not.toHaveBeenCalled()
  })
})
