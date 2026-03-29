import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, AppState } from 'react-native'
import { useKeepAwake } from 'expo-keep-awake'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { DEFAULT_WS_PORT, SessionSource } from '@remocoder/shared'
import { buildTerminalHtml } from '../assets/terminalHtml'
import { PermissionSheet, PermissionRequest } from '../components/PermissionSheet'
import { KeyboardToolbar } from '../components/KeyboardToolbar'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'
import { firstParam } from '../utils'

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'auth_error' | 'shell_exit'

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; color: string; bgColor: string }
> = {
  connecting: { label: 'Connecting...', color: '#d4d4d4', bgColor: 'rgba(100,100,100,0.8)' },
  connected: { label: 'Connected', color: '#4ec9b0', bgColor: 'rgba(0,80,60,0.8)' },
  reconnecting: { label: 'Reconnecting...', color: '#dcdcaa', bgColor: 'rgba(80,70,0,0.8)' },
  auth_error: { label: 'Auth Error', color: '#f44747', bgColor: 'rgba(80,0,0,0.8)' },
  shell_exit: { label: 'Session Ended', color: '#d4d4d4', bgColor: 'rgba(50,50,50,0.8)' },
}

export function TerminalScreen() {
  const raw = useLocalSearchParams<{
    ip: string
    token: string
    projectPath?: string
    sessionId?: string
    source?: string
  }>()
  const router = useRouter()

  const ip = firstParam(raw.ip)
  const token = firstParam(raw.token)
  const projectPath = firstParam(raw.projectPath)
  const sessionId = firstParam(raw.sessionId)
  const sourceJson = firstParam(raw.source)

  const source = useMemo<SessionSource | null>(() => {
    if (!sourceJson) return null
    try {
      return JSON.parse(sourceJson) as SessionSource
    } catch (err) {
      console.error('[TerminalScreen] source パラメータのパースに失敗しました:', err)
      return null
    }
  }, [sourceJson])

  const wsUrl = useMemo(() => `ws://${ip}:${DEFAULT_WS_PORT}`, [ip])
  const keyboardHeight = useKeyboardHeight()
  const insets = useSafeAreaInsets()
  const bottomPadding = keyboardHeight > 0 ? keyboardHeight : insets.bottom
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [webViewKey, setWebViewKey] = useState(0)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const webViewRef = useRef<WebView>(null)

  useKeepAwake()

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        // バックグラウンド移行時に WebSocket を明示的に閉じてサーバー側のデタッチを確実にする
        webViewRef.current?.injectJavaScript(
          'if (ws && ws.readyState === WebSocket.OPEN) { ws.close(); } true;',
        )
      }
    })
    return () => sub.remove()
  }, [])

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.nativeEvent.data)
      } catch (err) {
        console.error('[TerminalScreen] WebView メッセージのパースに失敗しました:', err)
        return
      }

      switch (msg.type) {
        case 'debug':
          console.log('[WebView debug]', msg.msg)
          break
        case 'auth_error':
          setStatus('auth_error')
          break
        case 'session_attached':
          setStatus('connected')
          setPendingPermission(null)
          break
        case 'connected':
          setStatus('connected')
          break
        case 'disconnected':
          setStatus('reconnecting')
          setPendingPermission(null)
          break
        case 'shell_exit':
          setStatus('shell_exit')
          break
        case 'session_not_found':
          setStatus('auth_error')
          break
        case 'permission_request':
          setPendingPermission({
            requestId: msg.requestId as string,
            toolName: msg.toolName as string,
            details: msg.details as string[],
            requiresAlways: msg.requiresAlways as boolean,
            createdAt: msg.createdAt as number,
          })
          break
        default:
          console.warn('[TerminalScreen] 未処理の WebView メッセージタイプ:', msg.type)
      }
    },
    [],
  )

  const handlePermissionDecide = useCallback(
    (requestId: string, decision: 'approve' | 'reject' | 'always') => {
      setPendingPermission(null)
      webViewRef.current?.injectJavaScript(
        `window.sendPermissionResponse(${JSON.stringify(requestId)}, ${JSON.stringify(decision)}); true;`,
      )
    },
    [],
  )

  const handleRetry = useCallback(() => {
    setStatus('connecting')
    setWebViewKey((k) => k + 1)
  }, [])

  const html = useMemo(
    () => buildTerminalHtml(wsUrl, token, projectPath || null, sessionId || null, source),
    [wsUrl, token, projectPath, sessionId, source],
  )
  const statusCfg = STATUS_CONFIG[status]
  const showRetry = status === 'auth_error' || status === 'shell_exit'

  return (
    <SafeAreaView style={[styles.container, { paddingBottom: bottomPadding }]} edges={['top', 'left', 'right']}>
      {/* ステータスバー */}
      <View style={[styles.statusBar, { backgroundColor: statusCfg.bgColor }]}>
        <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        <View style={styles.statusActions}>
          {showRetry && (
            <TouchableOpacity style={styles.actionButton} onPress={handleRetry}>
              <Text style={styles.actionButtonText}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionButton} onPress={() => router.back()}>
            <Text style={styles.actionButtonText}>Disconnect</Text>
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

      {/* カスタムキーボードツールバー */}
      <KeyboardToolbar webViewRef={webViewRef} />

      {/* 承認ボトムシート */}
      <PermissionSheet request={pendingPermission} onDecide={handlePermissionDecide} />
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
    alignItems: 'center',
  },
  actionButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#d4d4d4',
    fontSize: 12,
  },
})
