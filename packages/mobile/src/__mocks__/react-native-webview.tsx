import React from 'react'
import { View } from 'react-native'

export const injectJavaScriptMock = jest.fn()

export const WebView = React.forwardRef<any, any>((props, ref) => {
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: injectJavaScriptMock,
  }))
  return <View testID="webview" {...props} />
})

WebView.displayName = 'WebView'

export type WebViewMessageEvent = {
  nativeEvent: { data: string }
}
