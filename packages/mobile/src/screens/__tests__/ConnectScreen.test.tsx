import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { ConnectScreen } from '../ConnectScreen'
import AsyncStorage from '../../__mocks__/async-storage'

describe('ConnectScreen', () => {
  const onConnect = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    AsyncStorage.getMany.mockResolvedValue({ lastIp: null, lastToken: null })
  })

  it('ローディング中は ActivityIndicator が表示される', () => {
    // Never-resolving promise to keep loading state
    AsyncStorage.getMany.mockReturnValue(new Promise(() => {}))
    render(<ConnectScreen onConnect={onConnect} />)
    // During loading, form inputs are not rendered
    expect(screen.queryByPlaceholderText('100.x.x.x')).toBeNull()
  })

  it('AsyncStorage に値があれば入力欄に反映される', async () => {
    AsyncStorage.getMany.mockResolvedValue({ lastIp: '100.64.0.1', lastToken: 'saved-token' })
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByDisplayValue('100.64.0.1'))
    expect(screen.getByDisplayValue('100.64.0.1')).toBeTruthy()
    expect(screen.getByDisplayValue('saved-token')).toBeTruthy()
  })

  it('AsyncStorage が null を返す場合も正常動作する', async () => {
    AsyncStorage.getMany.mockResolvedValue({ lastIp: null, lastToken: null })
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))
    expect(screen.getByPlaceholderText('100.x.x.x')).toBeTruthy()
  })

  it('ip か token が空の場合はボタンを押しても onConnect が呼ばれない', async () => {
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByText('接続'))
    // Only ip filled, token empty
    fireEvent.changeText(screen.getByPlaceholderText('100.x.x.x'), '10.0.0.1')
    fireEvent.press(screen.getByText('接続'))
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('両方入力済みならボタン押下で onConnect が呼ばれる', async () => {
    AsyncStorage.setMany.mockResolvedValue(undefined)
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))

    fireEvent.changeText(screen.getByPlaceholderText('100.x.x.x'), '10.0.0.1')
    fireEvent.changeText(
      screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
      'my-token',
    )
    fireEvent.press(screen.getByText('接続'))
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('10.0.0.1', 'my-token'))
  })

  it('接続時に AsyncStorage.setMany が正しい値で呼ばれる', async () => {
    AsyncStorage.setMany.mockResolvedValue(undefined)
    render(<ConnectScreen onConnect={onConnect} />)
    await waitFor(() => screen.getByPlaceholderText('100.x.x.x'))

    fireEvent.changeText(screen.getByPlaceholderText('100.x.x.x'), '10.0.0.1')
    fireEvent.changeText(
      screen.getByPlaceholderText('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
      'save-token',
    )
    fireEvent.press(screen.getByText('接続'))
    await waitFor(() =>
      expect(AsyncStorage.setMany).toHaveBeenCalledWith({
        lastIp: '10.0.0.1',
        lastToken: 'save-token',
      }),
    )
  })
})
