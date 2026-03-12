import React from 'react'
import { View } from 'react-native'

export function WebView(props: any) {
  return <View testID="webview" {...props} />
}

export type WebViewMessageEvent = {
  nativeEvent: { data: string }
}
