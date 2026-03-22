import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { ForceUpdateScreen } from '../ForceUpdateScreen'
import { Linking } from 'react-native'

describe('ForceUpdateScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('タイトル「Update Required」を表示する', () => {
    render(<ForceUpdateScreen message="A new version is required" storeUrl="https://example.com" />)
    expect(screen.getByText('Update Required')).toBeTruthy()
  })

  it('message プロップを表示する', () => {
    render(<ForceUpdateScreen message="v2.0.0 or later is required" storeUrl="https://example.com" />)
    expect(screen.getByText('v2.0.0 or later is required')).toBeTruthy()
  })

  it('「Update on Store」ボタンを表示する', () => {
    render(<ForceUpdateScreen message="message" storeUrl="https://example.com" />)
    expect(screen.getByText('Update on Store')).toBeTruthy()
  })

  it('ボタンを押すと Linking.openURL が storeUrl で呼ばれる', () => {
    render(<ForceUpdateScreen message="message" storeUrl="https://apps.apple.com/app/123" />)
    fireEvent.press(screen.getByText('Update on Store'))
    expect(Linking.openURL).toHaveBeenCalledWith('https://apps.apple.com/app/123')
  })

  it('storeUrl が空のときボタンに disabled が設定される', () => {
    const { UNSAFE_getByType } = render(<ForceUpdateScreen message="message" storeUrl="" />)
    const { TouchableOpacity } = require('react-native')
    const button = UNSAFE_getByType(TouchableOpacity)
    expect(button.props.disabled).toBe(true)
  })
})
