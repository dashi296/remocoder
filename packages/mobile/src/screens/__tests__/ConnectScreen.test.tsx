import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { ConnectScreen } from '../ConnectScreen'
import AsyncStorage from '../../__mocks__/async-storage'

describe('ConnectScreen', () => {
  const onConnect = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    AsyncStorage.clear()
    AsyncStorage.getItem.mockResolvedValue(null)
  })

  it('ローディング中は ActivityIndicator が表示される', () => {
    AsyncStorage.getItem.mockReturnValue(new Promise(() => {}))
    render(<ConnectScreen onConnect={onConnect} />)
    expect(screen.queryByText('接続先を追加')).toBeNull()
  })

  it('プロファイルがない場合は空状態が表示される', async () => {
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByText('接続先がありません'))
    expect(screen.getByText('接続先がありません')).toBeTruthy()
    expect(screen.getByText('+ 接続先を追加')).toBeTruthy()
  })

  it('プロファイル一覧が表示される', async () => {
    const profiles = [
      { id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok1' },
      { id: '2', name: 'Desktop', ip: '100.64.0.2', token: 'tok2' },
    ]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByText('MacBook'))
    expect(screen.getByText('MacBook')).toBeTruthy()
    expect(screen.getByText('Desktop')).toBeTruthy()
  })

  it('プロファイルをタップすると onConnect が呼ばれる', async () => {
    AsyncStorage.setItem.mockResolvedValue(undefined)
    const profiles = [{ id: '1', name: 'MacBook', ip: '100.64.0.1', token: 'tok1' }]
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(profiles))
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByText('MacBook'))
    fireEvent.press(screen.getByText('MacBook'))
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('100.64.0.1', 'tok1'))
  })

  it('新規フォームでプロファイルを追加できる', async () => {
    AsyncStorage.getItem.mockResolvedValue(null)
    AsyncStorage.setItem.mockResolvedValue(undefined)
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByText('+ 接続先を追加'))

    fireEvent.press(screen.getByText('+ 接続先を追加'))
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))

    fireEvent.changeText(screen.getByPlaceholderText('100.x.x.x'), '10.0.0.1')
    fireEvent.changeText(
      screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
      'my-token',
    )
    fireEvent.press(screen.getByText('保存'))

    await waitFor(() => screen.getAllByText('10.0.0.1'))
    expect(screen.getAllByText('10.0.0.1').length).toBeGreaterThan(0)
  })

  it('フォームで ip か token が空の場合は保存ボタンが無効', async () => {
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByText('+ 接続先を追加'))
    fireEvent.press(screen.getByText('+ 接続先を追加'))
    await waitFor(() => screen.getByText('保存'))
    fireEvent.press(screen.getByText('保存'))
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('キャンセルボタンで一覧画面に戻る', async () => {
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByText('+ 接続先を追加'))
    fireEvent.press(screen.getByText('+ 接続先を追加'))
    await waitFor(() => screen.getByText('キャンセル'))
    fireEvent.press(screen.getByText('キャンセル'))
    await waitFor(() => screen.getByText('+ 接続先を追加'))
    expect(screen.getByText('+ 接続先を追加')).toBeTruthy()
  })
})
