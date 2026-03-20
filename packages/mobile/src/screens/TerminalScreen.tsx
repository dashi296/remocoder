import React, { useRef, useCallback, useState, useMemo } from 'react'
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { DEFAULT_WS_PORT, SessionInfo, ProjectInfo, SessionSource } from '@remocoder/shared'
import { buildTerminalHtml } from '../assets/terminalHtml'
import { PermissionSheet, PermissionRequest } from '../components/PermissionSheet'
import { SessionSwitcherModal } from '../components/SessionSwitcherModal'

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'auth_error' | 'shell_exit'

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

export function TerminalScreen() {
  const { ip, token, projectPath, sessionId, source: sourceJson } = useLocalSearchParams<{
    ip: string
    token: string
    projectPath?: string
    sessionId?: string
    source?: string
  }>()
  const router = useRouter()

  const source: SessionSource | null = sourceJson ? (JSON.parse(sourceJson) as SessionSource) : null
  const wsUrl = `ws://${ip}:${DEFAULT_WS_PORT}`
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [webViewKey, setWebViewKey] = useState(0)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [sessionList, setSessionList] = useState<SessionInfo[]>([])
  const [projectList, setProjectList] = useState<ProjectInfo[]>([])
  const [switcherLoading, setSwitcherLoading] = useState(false)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const webViewRef = useRef<WebView>(null)

  const closeSwitcher = useCallback(() => {
    setSwitcherLoading(false)
    setShowSwitcher(false)
  }, [])

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.nativeEvent.data)
      } catch {
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
          setCurrentSessionId(msg.sessionId as string)
          setStatus('connected')
          setPendingPermission(null)
          closeSwitcher()
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
          closeSwitcher()
          break
        case 'session_list_response':
          setSessionList(msg.sessions as SessionInfo[])
          setProjectList(msg.projects as ProjectInfo[])
          setSwitcherLoading(false)
          setShowSwitcher(true)
          break
        case 'permission_request':
          setPendingPermission({
            requestId: msg.requestId as string,
            toolName: msg.toolName as string,
            details: msg.details as string[],
            requiresAlways: msg.requiresAlways as boolean,
          })
          break
      }
    },
    [closeSwitcher],
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
    setCurrentSessionId(null)
    setWebViewKey((k) => k + 1)
  }, [])

  const handleOpenSwitcher = useCallback(() => {
    setSwitcherLoading(true)
    webViewRef.current?.injectJavaScript('window.requestSessionList(); true;')
  }, [])

  const handleSwitchToSession = useCallback((sessionId: string) => {
    setSwitcherLoading(true)
    webViewRef.current?.injectJavaScript(
      `window.switchToSession(${JSON.stringify(sessionId)}); true;`,
    )
  }, [])

  const handleCreateNewSession = useCallback((newProjectPath: string | null) => {
    setSwitcherLoading(true)
    webViewRef.current?.injectJavaScript(
      `window.createNewSession(${JSON.stringify(newProjectPath)}); true;`,
    )
  }, [])

  const html = useMemo(
    () => buildTerminalHtml(wsUrl, token, projectPath || null, sessionId || null, source),
    [wsUrl, token, projectPath, sessionId, source],
  )
  const statusCfg = STATUS_CONFIG[status]
  const showRetry = status === 'auth_error' || status === 'shell_exit'

  return (
    <SafeAreaView style={styles.container}>
      {/* ステータスバー */}
      <View style={[styles.statusBar, { backgroundColor: statusCfg.bgColor }]}>
        <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        <View style={styles.statusActions}>
          {/* DEBUG: PermissionSheet動作確認（開発ビルドのみ） */}
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: 'rgba(220,180,0,0.3)' }]}
              onPress={() =>
                setPendingPermission({
                  requestId: 'debug-001',
                  toolName: 'Bash',
                  details: ['rm -rf /tmp/test', 'ls -la /Users/user/projects'],
                  requiresAlways: true,
                })
              }
            >
              <Text style={styles.actionButtonText}>TEST</Text>
            </TouchableOpacity>
          )}
          {status === 'connected' && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleOpenSwitcher}
              disabled={switcherLoading}
            >
              {switcherLoading ? (
                <ActivityIndicator size="small" color="#d4d4d4" />
              ) : (
                <Text style={styles.actionButtonText}>切替</Text>
              )}
            </TouchableOpacity>
          )}
          {showRetry && (
            <TouchableOpacity style={styles.actionButton} onPress={handleRetry}>
              <Text style={styles.actionButtonText}>再試行</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionButton} onPress={() => router.replace('/')}>
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

      {/* 承認ボトムシート */}
      <PermissionSheet request={pendingPermission} onDecide={handlePermissionDecide} />

      {/* セッション切替モーダル */}
      <SessionSwitcherModal
        visible={showSwitcher}
        loading={switcherLoading}
        sessions={sessionList}
        projects={projectList}
        currentSessionId={currentSessionId}
        onClose={() => setShowSwitcher(false)}
        onSwitchSession={handleSwitchToSession}
        onCreateSession={handleCreateNewSession}
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
