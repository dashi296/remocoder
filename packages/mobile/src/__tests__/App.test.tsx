import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import App from '../App'
import AsyncStorage from '../__mocks__/async-storage'

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    AsyncStorage._store && Object.keys(AsyncStorage._store).forEach((k) => delete AsyncStorage._store[k])
    AsyncStorage.getMany.mockResolvedValue({ lastIp: null, lastToken: null })
  })

  it('初期画面: ConnectScreen が表示される', async () => {
    render(<App />)
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))
    expect(screen.getByPlaceholderText('100.x.x.x')).toBeTruthy()
  })

  it('接続後: TerminalScreen が表示される', async () => {
    AsyncStorage.getMany.mockResolvedValue({ lastIp: '100.64.0.1', lastToken: 'tok' })
    AsyncStorage.setMany.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))

    fireEvent.changeText(screen.getByPlaceholderText('100.x.x.x'), '100.64.0.1')
    fireEvent.changeText(
      screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
      'my-token',
    )
    fireEvent.press(screen.getByText('接続'))

    await waitFor(() => screen.getByTestId('webview'))
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('切断後: ConnectScreen に戻る', async () => {
    AsyncStorage.setMany.mockResolvedValue(undefined)

    render(<App />)
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))

    fireEvent.changeText(screen.getByPlaceholderText('100.x.x.x'), '10.0.0.1')
    fireEvent.changeText(
      screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
      'tok',
    )
    fireEvent.press(screen.getByText('接続'))

    await waitFor(() => screen.getByTestId('webview'))

    // 切断ボタンを押す
    fireEvent.press(screen.getByText('切断'))

    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))
    expect(screen.getByPlaceholderText('100.x.x.x')).toBeTruthy()
  })
})
