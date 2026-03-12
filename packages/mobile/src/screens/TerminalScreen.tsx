import React, { useRef, useCallback } from 'react'
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { DEFAULT_WS_PORT } from '@remocoder/shared'
import { buildTerminalHtml } from '../assets/terminal.html'

interface Props {
  ip: string
  token: string
  onAuthError: () => void
}

export function TerminalScreen({ ip, token, onAuthError }: Props) {
  const wsUrl = `ws://${ip}:${DEFAULT_WS_PORT}`
  const html = buildTerminalHtml(wsUrl, token)
  const webViewRef = useRef<WebView>(null)

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data)
        if (msg.type === 'auth_error') {
          onAuthError()
        }
      } catch {
        // 無視
      }
    },
    [onAuthError],
  )

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
        javaScriptEnabled
        onMessage={handleMessage}
        allowFileAccess={false}
      />
      <TouchableOpacity style={styles.disconnectButton} onPress={onAuthError}>
        <Text style={styles.disconnectText}>切断</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1e1e1e' },
  webview: { flex: 1 },
  disconnectButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  disconnectText: {
    color: '#d4d4d4',
    fontSize: 13,
  },
})
