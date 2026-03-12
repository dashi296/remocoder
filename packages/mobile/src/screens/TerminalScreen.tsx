import React, { useRef, useCallback, useState } from 'react'
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { DEFAULT_WS_PORT } from '@remocoder/shared'
import { buildTerminalHtml } from '../assets/terminalHtml'

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'auth_error' | 'shell_exit'

interface Props {
  ip: string
  token: string
  /** アタッチ先セッションID。null または未指定で新規セッション作成 */
  sessionId?: string | null
  onDisconnect: () => void
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; color: string; bgColor: string }
> = {
  connecting: { label: '接続中...', color: '#d4d4d4', bgColor: 'rgba(100,100,100,0.8)' },
  connected: { label: '接続済み', color: '#4ec9b0', bgColor: 'rgba(0,80,60,0.8)' },
  reconnecting: { label: '再接続中...', color: '#dcdcaa', bgColor: 'rgba(80,70,0,0.8)' },
  auth_error: { label: '認証エラー', color: '#f44747', bgColor: 'rgba(80,0,0,0.8)' },
  shell_exit: { label: 'セッション終了', color: '#d4d4d4', bgColor: 'rgba(50,50,50,0.8)' },
}

export function TerminalScreen({ ip, token, sessionId, onDisconnect }: Props) {
  const wsUrl = `ws://${ip}:${DEFAULT_WS_PORT}`
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [webViewKey, setWebViewKey] = useState(0)
  const webViewRef = useRef<WebView>(null)

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data)
        if (msg.type === 'debug') {
          console.log('[WebView debug]', msg.msg)
        } else if (msg.type === 'auth_error') {
          setStatus('auth_error')
        } else if (msg.type === 'auth_ok') {
          // auth_ok 後はセッション選択待ち状態 → session_attached で connected へ
        } else if (msg.type === 'session_attached') {
          setStatus('connected')
        } else if (msg.type === 'connected') {
          setStatus('connected')
        } else if (msg.type === 'disconnected') {
          setStatus('reconnecting')
        } else if (msg.type === 'shell_exit') {
          setStatus('shell_exit')
        } else if (msg.type === 'session_not_found') {
          setStatus('auth_error')
        }
      } catch {
        // 無視
      }
    },
    [],
  )

  const handleRetry = useCallback(() => {
    setStatus('connecting')
    // WebViewを再マウントして接続をリセット
    setWebViewKey((k) => k + 1)
  }, [])

  const html = buildTerminalHtml(wsUrl, token, sessionId ?? null)
  const statusCfg = STATUS_CONFIG[status]
  const showRetry = status === 'auth_error' || status === 'shell_exit'

  return (
    <SafeAreaView style={styles.container}>
      {/* ステータスバー */}
      <View style={[styles.statusBar, { backgroundColor: statusCfg.bgColor }]}>
        <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        <View style={styles.statusActions}>
          {showRetry && (
            <TouchableOpacity style={styles.actionButton} onPress={handleRetry}>
              <Text style={styles.actionButtonText}>再試行</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionButton} onPress={onDisconnect}>
            <Text style={styles.actionButtonText}>切断</Text>
          </TouchableOpacity>
        </View>
      </View>
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ html, baseUrl: 'http://localhost/' }}
        style={styles.webview}
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
        javaScriptEnabled
        onMessage={handleMessage}
        allowFileAccess={false}
        onError={(e) => console.error('WebView error:', e.nativeEvent)}
        onHttpError={(e) => console.error('WebView HTTP error:', e.nativeEvent.statusCode)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1e1e1e' },
  webview: { flex: 1 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  actionButtonText: {
    color: '#d4d4d4',
    fontSize: 12,
  },
})
