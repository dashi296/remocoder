import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ForceUpdateScreen } from '../ForceUpdateScreen'
import { Linking } from 'react-native'

describe('ForceUpdateScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('タイトル「アップデートが必要です」を表示する', () => {
    render(<ForceUpdateScreen message="新しいバージョンが必要です" storeUrl="https://example.com" />)
    expect(screen.getByText('アップデートが必要です')).toBeTruthy()
  })

  it('message プロップを表示する', () => {
    render(<ForceUpdateScreen message="v2.0.0 以降が必要です" storeUrl="https://example.com" />)
    expect(screen.getByText('v2.0.0 以降が必要です')).toBeTruthy()
  })

  it('「ストアでアップデート」ボタンを表示する', () => {
    render(<ForceUpdateScreen message="message" storeUrl="https://example.com" />)
    expect(screen.getByText('ストアでアップデート')).toBeTruthy()
  })

  it('ボタンを押すと Linking.openURL が storeUrl で呼ばれる', () => {
    render(<ForceUpdateScreen message="message" storeUrl="https://apps.apple.com/app/123" />)
    fireEvent.press(screen.getByText('ストアでアップデート'))
    expect(Linking.openURL).toHaveBeenCalledWith('https://apps.apple.com/app/123')
  })

  it('storeUrl が空のときボタンに disabled が設定される', () => {
    const { UNSAFE_getByType } = render(<ForceUpdateScreen message="message" storeUrl="" />)
    const { TouchableOpacity } = require('react-native')
    const button = UNSAFE_getByType(TouchableOpacity)
    expect(button.props.disabled).toBe(true)
  })
})
