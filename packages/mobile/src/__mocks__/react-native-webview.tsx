import React from 'react'
import { View } from 'react-native'

export const WebView = React.forwardRef((props: any, _ref: any) => (
  <View testID="webview" />
))

WebView.displayName = 'WebView'

export type WebViewMessageEvent = {
  nativeEvent: { data: string }
}
