/**
 * Minimal react-native mock for jest tests.
 * Avoids loading Flow-typed react-native source files which require the
 * metro/babel toolchain not present in this workspace.
 */
import React from 'react'

// Basic host components — each returns a host element (string type)
// so @testing-library/react-native can detect them via detectHostComponentNames.
const View = (props: any) => React.createElement('View', props)
const Text = (props: any) => React.createElement('Text', props)
const TextInput = (props: any) => React.createElement('TextInput', props)
const TouchableOpacity = (props: any) => React.createElement('TouchableOpacity', props)
const ActivityIndicator = (props: any) => React.createElement('ActivityIndicator', props)

// Components required by @testing-library/react-native detectHostComponentNames
const Image = (props: any) => React.createElement('Image', props)
const Switch = (props: any) => React.createElement('Switch', props)
const ScrollView = (props: any) => React.createElement('ScrollView', props)
// visible=false のときは children を描画しない（実機 Modal の挙動に合わせる）
// ただし Modal 要素自体は残す（@testing-library/react-native の detectHostComponentNames に必要）
const Modal = ({ visible, children, ...rest }: any) =>
  React.createElement('Modal', rest, visible ? children : null)

// Button renders title as a Text child so getByText('title') works,
// and disables onPress when disabled=true so fireEvent.press has no effect.
const Button = ({ title, onPress, disabled, testID }: any) =>
  React.createElement(
    'TouchableOpacity',
    { onPress: disabled ? undefined : onPress, disabled, testID },
    React.createElement('Text', null, title),
  )

// FlatList renders each item via renderItem
const FlatList = ({ data, renderItem, keyExtractor }: any) =>
  React.createElement(
    'View',
    null,
    ...(data ?? []).map((item: any, index: number) =>
      renderItem({ item, index }),
    ),
  )

// Animated mock — supports Value, timing, spring, and View/Text
class AnimatedValue {
  _value: number
  constructor(val: number) {
    this._value = val
  }
  setValue(val: number) {
    this._value = val
  }
  interpolate(_config: any) {
    return this
  }
}

const Animated = {
  Value: AnimatedValue,
  View: (props: any) => React.createElement('View', props),
  Text: (props: any) => React.createElement('Text', props),
  timing: (_value: any, _config: any) => ({ start: jest.fn() }),
  spring: (_value: any, _config: any) => ({ start: jest.fn() }),
  sequence: (_animations: any[]) => ({ start: jest.fn() }),
  parallel: (_animations: any[]) => ({ start: jest.fn() }),
  delay: (_ms: number) => ({ start: jest.fn() }),
}

const Alert = {
  alert: jest.fn((title: string, message: string, buttons: any[]) => {
    // テスト内で手動にボタンを呼び出せるよう最後のボタンの onPress を即時実行しない
  }),
}

const Linking = {
  openURL: jest.fn().mockResolvedValue(undefined),
}

const StyleSheet = {
  create: (styles: any) => styles,
  flatten: (style: any) => style,
  hairlineWidth: 0.5,
}

const Platform = {
  OS: 'ios' as const,
  Version: 16,
  select: (obj: any) => obj.ios ?? obj.default,
}

export {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Switch,
  ScrollView,
  Modal,
  Button,
  FlatList,
  Alert,
  Linking,
  StyleSheet,
  Platform,
  Animated,
}
