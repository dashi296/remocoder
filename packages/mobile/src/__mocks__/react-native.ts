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
const Modal = (props: any) => React.createElement('Modal', props)

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

const Alert = {
  alert: jest.fn((title: string, message: string, buttons: any[]) => {
    // テスト内で手動にボタンを呼び出せるよう最後のボタンの onPress を即時実行しない
  }),
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
  StyleSheet,
  Platform,
}
