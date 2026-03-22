import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { ConnectScreen } from '../ConnectScreen'
import AsyncStorage from '../../__mocks__/async-storage'
import { mockRouterPush, mockRouterReplace } from '../../__mocks__/expo-router'

describe('ConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    AsyncStorage.clear()
    AsyncStorage.getItem.mockResolvedValue(null)
  })

  it('ローディング中は ActivityIndicator が表示される', () => {
    AsyncStorage.getItem.mockReturnValue(new Promise(() => {}))
    render(<ConnectScreen />)
    expect(screen.queryByText('接続先を追加')).toBeNull()
  })

  it('プロファイルがない場合は空状態が表示される', async () => {
    render(<ConnectScreen />)
    await waitFor(() => screen.getByText('No connections'))
    expect(screen.getByText('No connections')).toBeTruthy()
    expect(screen.getByText('+ Add Connection')).toBeTruthy()
  })

  it('プロファイル一覧が表示される', async () => {
    const profiles = [
      { id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok1' },
      { id: '2', name: 'Desktop', ip: '100.64.0.2', token: 'tok2' },
    ]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    render(<ConnectScreen />)
    await waitFor(() => screen.getByText('MacBook'))
    expect(screen.getByText('MacBook')).toBeTruthy()
    expect(screen.getByText('Desktop')).toBeTruthy()
  })

  it('プロファイルをタップすると /session-picker に replace ナビゲートする', async () => {
    AsyncStorage.setItem.mockResolvedValue(undefined)
    const profiles = [{ id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok1' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    render(<ConnectScreen />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))
    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/session-picker',
        params: { ip: '100.64.0.1', token: 'tok1', profileId: '1' },
      }),
    )
  })

  it('新規フォームでプロファイルを追加できる', async () => {
    AsyncStorage.getItem.mockResolvedValue(null)
    AsyncStorage.setItem.mockResolvedValue(undefined)
    render(<ConnectScreen />)
    await waitFor(() => screen.getByText('+ Add Connection'))

    fireEvent.press(screen.getByText('+ Add Connection'))
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))

    fireEvent.changeText(screen.getByPlaceholderText('100.x.x.x'), '10.0.0.1')
    fireEvent.changeText(
      screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
      'my-token',
    )
    fireEvent.press(screen.getByText('Save'))

    await waitFor(() => screen.getAllByText('10.0.0.1'))
    expect(screen.getAllByText('10.0.0.1').length).toBeGreaterThan(0)
  })

  it('フォームで ip か token が空の場合はSaveボタンが無効', async () => {
    render(<ConnectScreen />)
    await waitFor(() => screen.getByText('+ Add Connection'))
    fireEvent.press(screen.getByText('+ Add Connection'))
    await waitFor(() => screen.getByText('Save'))
    fireEvent.press(screen.getByText('Save'))
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('Cancelボタンで一覧画面に戻る', async () => {
    render(<ConnectScreen />)
    await waitFor(() => screen.getByText('+ Add Connection'))
    fireEvent.press(screen.getByText('+ Add Connection'))
    await waitFor(() => screen.getByText('Cancel'))
    fireEvent.press(screen.getByText('Cancel'))
    await waitFor(() => screen.getByText('+ Add Connection'))
    expect(screen.getByText('+ Add Connection')).toBeTruthy()
  })
})
