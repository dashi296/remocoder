import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { TerminalScreen } from '../TerminalScreen'
import { WebView } from '../../__mocks__/react-native-webview'

describe('TerminalScreen', () => {
  const onAuthError = jest.fn()
  const defaultProps = { ip: '100.64.0.1', token: 'test-token', onAuthError }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('WebView が render される', () => {
    render(<TerminalScreen {...defaultProps} />)
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('WebView から auth_error メッセージ → onAuthError が呼ばれる', () => {
    render(<TerminalScreen {...defaultProps} />)
    const webViewEl = screen.UNSAFE_getByType(WebView)
    act(() => {
      webViewEl.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'auth_error', reason: 'invalid token' }) },
      })
    })
    expect(onAuthError).toHaveBeenCalled()
  })

  it('auth_error 以外のメッセージでは onAuthError を呼ばない', () => {
    render(<TerminalScreen {...defaultProps} />)
    const webViewEl = screen.UNSAFE_getByType(WebView)
    act(() => {
      webViewEl.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'disconnected' }) },
      })
    })
    expect(onAuthError).not.toHaveBeenCalled()
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

  it('切断ボタン押下で onAuthError が呼ばれる', () => {
    render(<TerminalScreen {...defaultProps} />)
    fireEvent.press(screen.getByText('切断'))
    expect(onAuthError).toHaveBeenCalled()
  })
})
