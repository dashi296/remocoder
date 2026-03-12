import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import App from '../App'
import AsyncStorage from '../__mocks__/async-storage'

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    AsyncStorage.clear()
    AsyncStorage.getItem.mockResolvedValue(null)
  })

  it('初期画面: ConnectScreen が表示される', async () => {
    render(<App />)
    await waitFor(() => screen.getByText('接続先がありません'))
    expect(screen.getByText('接続先がありません')).toBeTruthy()
  })

  it('接続後: TerminalScreen が表示される', async () => {
    const profiles = [{ id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    AsyncStorage.setItem.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))

    await waitFor(() => screen.getByTestId('webview'))
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('切断後: ConnectScreen に戻る', async () => {
    const profiles = [{ id: '1', name: 'MacBook', ip: '10.0.0.1', token: 'tok' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    AsyncStorage.setItem.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))

    await waitFor(() => screen.getByTestId('webview'))

    fireEvent.press(screen.getByText('切断'))

    // プロファイル一覧画面に戻る（MacBook プロファイルが表示される）
    await waitFor(() => screen.getByText('MacBook'))
    expect(screen.getByText('MacBook')).toBeTruthy()
  })
})
