import React, { useRef, useCallback, useState, useMemo } from 'react'
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { DEFAULT_WS_PORT, SessionInfo, ProjectInfo, SessionSource } from '@remocoder/shared'
import { buildTerminalHtml } from '../assets/terminalHtml'
import { formatDate, getSessionDisplayName } from '../utils'
import { PermissionSheet, PermissionRequest } from '../components/PermissionSheet'

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'auth_error' | 'shell_exit'

interface Props {
  ip: string
  token: string
  /** セッションを起動するプロジェクトパス。null または未指定でプロジェクトなし */
  projectPath?: string | null
  /** アタッチする既存セッションID。指定時は projectPath より優先される */
  sessionId?: string | null
  /** セッション起動元。指定時は projectPath より優先して session_create の source に使用 */
  source?: SessionSource | null
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

export function TerminalScreen({ ip, token, projectPath, sessionId, source, onDisconnect }: Props) {
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
      try {
        const msg = JSON.parse(event.nativeEvent.data)
        if (msg.type === 'debug') {
          console.log('[WebView debug]', msg.msg)
        } else if (msg.type === 'auth_error') {
          setStatus('auth_error')
        } else if (msg.type === 'auth_ok') {
          // auth_ok 後はセッション選択待ち状態 → session_attached で connected へ
        } else if (msg.type === 'session_attached') {
          setCurrentSessionId(msg.sessionId)
          setStatus('connected')
          closeSwitcher()
        } else if (msg.type === 'connected') {
          setStatus('connected')
        } else if (msg.type === 'disconnected') {
          setStatus('reconnecting')
        } else if (msg.type === 'shell_exit') {
          setStatus('shell_exit')
        } else if (msg.type === 'session_not_found') {
          setStatus('auth_error')
          closeSwitcher()
        } else if (msg.type === 'session_list_response') {
          setSessionList(msg.sessions)
          setProjectList(msg.projects)
          setSwitcherLoading(false)
          setShowSwitcher(true)
        } else if (msg.type === 'permission_request') {
          setPendingPermission({
            requestId: msg.requestId,
            toolName: msg.toolName,
            details: msg.details,
            requiresAlways: msg.requiresAlways,
          })
        }
      } catch {
        // 無視
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
    () => buildTerminalHtml(wsUrl, token, projectPath ?? null, sessionId ?? null, source ?? null),
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

      {/* 承認ボトムシート */}
      <PermissionSheet request={pendingPermission} onDecide={handlePermissionDecide} />

      {/* セッション切替モーダル */}
      <Modal
        visible={showSwitcher}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSwitcher(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* モーダルヘッダー */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>セッション切替</Text>
              <TouchableOpacity onPress={() => setShowSwitcher(false)} style={styles.modalCloseBtn}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* 実行中のセッション */}
              {sessionList.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>実行中のセッション</Text>
                  {sessionList.map((session) => {
                    const isCurrent = session.id === currentSessionId
                    const name = getSessionDisplayName(session)
                    return (
                      <TouchableOpacity
                        key={session.id}
                        style={[styles.sessionRow, isCurrent && styles.sessionRowCurrent]}
                        onPress={() => !isCurrent && handleSwitchToSession(session.id)}
                        disabled={isCurrent}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            session.status === 'active' ? styles.dotActive : styles.dotIdle,
                          ]}
                        />
                        <View style={styles.sessionInfo}>
                          <Text style={styles.sessionName}>{name}</Text>
                          {session.projectPath && (
                            <Text style={styles.sessionPath} numberOfLines={1} ellipsizeMode="middle">
                              {session.projectPath}
                            </Text>
                          )}
                        </View>
                        {isCurrent ? (
                          <Text style={styles.currentBadge}>現在</Text>
                        ) : (
                          <Text style={styles.switchArrow}>→</Text>
                        )}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}

              {/* 新規セッション作成 */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>新規セッション</Text>
                <TouchableOpacity
                  style={styles.newSessionButton}
                  onPress={() => handleCreateNewSession(null)}
                >
                  <Text style={styles.newSessionIcon}>＋</Text>
                  <Text style={styles.newSessionText}>プロジェクトなし</Text>
                </TouchableOpacity>
                {projectList.map((project) => (
                  <TouchableOpacity
                    key={project.path}
                    style={styles.projectRow}
                    onPress={() => handleCreateNewSession(project.path)}
                  >
                    <View style={styles.projectLeft}>
                      <Text style={styles.projectName}>{project.name}</Text>
                      <Text style={styles.projectPath} numberOfLines={1} ellipsizeMode="middle">
                        {project.path}
                      </Text>
                    </View>
                    <Text style={styles.projectDate}>{formatDate(project.lastUsedAt)}</Text>
                  </TouchableOpacity>
                ))}
                {projectList.length === 0 && (
                  <Text style={styles.emptyText}>最近使ったプロジェクトはありません</Text>
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  // ── モーダル ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#0d1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    color: '#c9d1d9',
    fontSize: 16,
    fontWeight: '600',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseText: {
    color: '#8b949e',
    fontSize: 16,
  },
  modalScroll: {
    paddingHorizontal: 16,
  },
  section: {
    paddingVertical: 12,
  },
  sectionTitle: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    gap: 10,
  },
  sessionRowCurrent: {
    borderColor: 'rgba(78,201,176,0.4)',
    backgroundColor: 'rgba(78,201,176,0.05)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  dotActive: {
    backgroundColor: '#4ec9b0',
  },
  dotIdle: {
    backgroundColor: '#dcdcaa',
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },
  sessionName: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: '600',
  },
  sessionPath: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  currentBadge: {
    color: '#4ec9b0',
    fontSize: 11,
    fontWeight: '600',
  },
  switchArrow: {
    color: '#8b949e',
    fontSize: 14,
  },
  newSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(78,201,176,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(78,201,176,0.3)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  newSessionIcon: {
    color: '#4ec9b0',
    fontSize: 18,
    lineHeight: 20,
  },
  newSessionText: {
    color: '#4ec9b0',
    fontSize: 14,
    fontWeight: '600',
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
    gap: 8,
  },
  projectLeft: {
    flex: 1,
    gap: 3,
  },
  projectName: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: '600',
  },
  projectPath: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  projectDate: {
    color: '#8b949e',
    fontSize: 11,
    flexShrink: 0,
  },
  emptyText: {
    color: '#8b949e',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
})
