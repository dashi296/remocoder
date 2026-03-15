import React, { useRef, useCallback, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SessionSource, SessionInfo, ProjectInfo } from '@remocoder/shared'
import { useCcWebSocket, ChatItem } from '../hooks/useCcWebSocket'
import { AssistantBubble } from '../components/chat/AssistantBubble'
import { UserBubble } from '../components/chat/UserBubble'
import { ToolUseBubble } from '../components/chat/ToolUseBubble'
import { ToolResultBubble } from '../components/chat/ToolResultBubble'
import { PermissionCard } from '../components/chat/PermissionCard'
import { formatDate, getSessionDisplayName } from '../utils'

// ──────────────────────────────────────────────────────────────────────────────
// 型・定数
// ──────────────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'auth_error' | 'ended'

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string; bgColor: string }> = {
  connecting: { label: '接続中...', color: '#d4d4d4', bgColor: 'rgba(100,100,100,0.8)' },
  connected: { label: '接続済み', color: '#4ec9b0', bgColor: 'rgba(0,80,60,0.8)' },
  reconnecting: { label: '再接続中...', color: '#dcdcaa', bgColor: 'rgba(80,70,0,0.8)' },
  auth_error: { label: '認証エラー', color: '#f44747', bgColor: 'rgba(80,0,0,0.8)' },
  ended: { label: 'セッション終了', color: '#d4d4d4', bgColor: 'rgba(50,50,50,0.8)' },
}

// ──────────────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────────────

interface Props {
  ip: string
  token: string
  projectPath?: string | null
  sessionId?: string | null
  source?: SessionSource | null
  onDisconnect: () => void
}

// ──────────────────────────────────────────────────────────────────────────────
// ChatScreen
// ──────────────────────────────────────────────────────────────────────────────

export function ChatScreen({ ip, token, projectPath, sessionId, source, onDisconnect }: Props) {
  const {
    status,
    items,
    currentSessionId,
    sessionList,
    projectList,
    sendMessage,
    respondPermission,
    switchSession,
    createSession,
  } = useCcWebSocket({ ip, token, projectPath, sessionId, source })

  const [inputText, setInputText] = useState('')
  const [showSwitcher, setShowSwitcher] = useState(false)
  const flatListRef = useRef<FlatList<ChatItem>>(null)

  const statusCfg = STATUS_CONFIG[status as ConnectionStatus]

  const handleContentSizeChange = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true })
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim()
    if (!trimmed || status !== 'connected') return
    sendMessage(trimmed)
    setInputText('')
  }, [inputText, status, sendMessage])

  const handleSwitchSession = useCallback(
    (sid: string) => {
      setShowSwitcher(false)
      switchSession(sid)
    },
    [switchSession],
  )

  const handleCreateSession = useCallback(
    (path: string | null) => {
      setShowSwitcher(false)
      createSession(path)
    },
    [createSession],
  )

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      switch (item.kind) {
        case 'user':
          return <UserBubble content={item.content} />
        case 'assistant':
          return <AssistantBubble content={item.content} />
        case 'tool_use':
          return <ToolUseBubble toolName={item.toolName} input={item.input} />
        case 'tool_result':
          return (
            <ToolResultBubble
              toolUseId={item.toolUseId}
              content={item.content}
              isError={item.isError}
            />
          )
        case 'permission':
          return (
            <PermissionCard
              permissionId={item.permissionId}
              toolName={item.toolName}
              input={item.input}
              prompt={item.prompt}
              responded={item.responded}
              approved={item.approved}
              onRespond={respondPermission}
            />
          )
      }
    },
    [respondPermission],
  )

  return (
    <SafeAreaView style={styles.container}>
      {/* ステータスバー */}
      <View style={[styles.statusBar, { backgroundColor: statusCfg.bgColor }]}>
        <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        <View style={styles.statusActions}>
          {status === 'connected' && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => setShowSwitcher(true)}>
              <Text style={styles.actionBtnText}>切替</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionBtn} onPress={onDisconnect}>
            <Text style={styles.actionBtnText}>切断</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* チャット一覧 */}
      <FlatList
        ref={flatListRef}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState status={status as ConnectionStatus} />}
        onContentSizeChange={handleContentSizeChange}
      />

      {/* 入力エリア */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.inputArea}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="メッセージを入力..."
            placeholderTextColor="#8b949e"
            multiline
            maxLength={4000}
            editable={status === 'connected'}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || status !== 'connected') && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || status !== 'connected'}
            activeOpacity={0.7}
          >
            <Text style={styles.sendBtnText}>送信</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* セッション切替モーダル */}
      <SessionSwitcherModal
        visible={showSwitcher}
        sessionList={sessionList}
        projectList={projectList}
        currentSessionId={currentSessionId}
        onClose={() => setShowSwitcher(false)}
        onSwitch={handleSwitchSession}
        onCreate={handleCreateSession}
      />
    </SafeAreaView>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// サブコンポーネント
// ──────────────────────────────────────────────────────────────────────────────

function EmptyState({ status }: { status: ConnectionStatus }) {
  if (status === 'connecting' || status === 'reconnecting') {
    return (
      <View style={emptyStyles.container}>
        <ActivityIndicator size="large" color="#4ec9b0" />
        <Text style={emptyStyles.text}>接続中...</Text>
      </View>
    )
  }
  if (status === 'connected') {
    return (
      <View style={emptyStyles.container}>
        <Text style={emptyStyles.emoji}>💬</Text>
        <Text style={emptyStyles.text}>Claude にメッセージを送ってみてください</Text>
      </View>
    )
  }
  return null
}

interface SessionSwitcherModalProps {
  visible: boolean
  sessionList: SessionInfo[]
  projectList: ProjectInfo[]
  currentSessionId: string | null
  onClose: () => void
  onSwitch: (sessionId: string) => void
  onCreate: (projectPath: string | null) => void
}

function SessionSwitcherModal({
  visible,
  sessionList,
  projectList,
  currentSessionId,
  onClose,
  onSwitch,
  onCreate,
}: SessionSwitcherModalProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.container}>
          <View style={modalStyles.header}>
            <Text style={modalStyles.title}>セッション切替</Text>
            <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
              <Text style={modalStyles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={modalStyles.scroll} showsVerticalScrollIndicator={false}>
            {sessionList.length > 0 && (
              <View style={modalStyles.section}>
                <Text style={modalStyles.sectionTitle}>実行中のセッション</Text>
                {sessionList.map((session) => {
                  const isCurrent = session.id === currentSessionId
                  return (
                    <TouchableOpacity
                      key={session.id}
                      style={[modalStyles.row, isCurrent && modalStyles.rowCurrent]}
                      onPress={() => !isCurrent && onSwitch(session.id)}
                      disabled={isCurrent}
                    >
                      <View
                        style={[
                          modalStyles.dot,
                          session.status === 'active' ? modalStyles.dotActive : modalStyles.dotIdle,
                        ]}
                      />
                      <View style={modalStyles.rowInfo}>
                        <Text style={modalStyles.rowName}>{getSessionDisplayName(session)}</Text>
                        {session.projectPath && (
                          <Text style={modalStyles.rowPath} numberOfLines={1} ellipsizeMode="middle">
                            {session.projectPath}
                          </Text>
                        )}
                      </View>
                      {isCurrent ? (
                        <Text style={modalStyles.currentBadge}>現在</Text>
                      ) : (
                        <Text style={modalStyles.arrow}>→</Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}

            <View style={modalStyles.section}>
              <Text style={modalStyles.sectionTitle}>新規セッション</Text>
              <TouchableOpacity
                style={modalStyles.newSessionBtn}
                onPress={() => onCreate(null)}
              >
                <Text style={modalStyles.newSessionIcon}>＋</Text>
                <Text style={modalStyles.newSessionText}>プロジェクトなし</Text>
              </TouchableOpacity>
              {projectList.map((project) => (
                <TouchableOpacity
                  key={project.path}
                  style={modalStyles.projectRow}
                  onPress={() => onCreate(project.path)}
                >
                  <View style={modalStyles.projectLeft}>
                    <Text style={modalStyles.projectName}>{project.name}</Text>
                    <Text style={modalStyles.projectPath} numberOfLines={1} ellipsizeMode="middle">
                      {project.path}
                    </Text>
                  </View>
                  <Text style={modalStyles.projectDate}>{formatDate(project.lastUsedAt)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// スタイル
// ──────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: { fontSize: 12, fontWeight: '600' },
  statusActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  actionBtnText: { color: '#d4d4d4', fontSize: 12 },
  listContent: {
    paddingVertical: 12,
    flexGrow: 1,
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#161b22',
  },
  input: {
    flex: 1,
    color: '#c9d1d9',
    fontSize: 15,
    backgroundColor: '#0d1117',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sendBtn: {
    backgroundColor: '#0e7afb',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignSelf: 'flex-end',
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(14,122,251,0.35)',
  },
  sendBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
})

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emoji: { fontSize: 40 },
  text: { color: '#8b949e', fontSize: 14, textAlign: 'center' },
})

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#0d1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: { color: '#c9d1d9', fontSize: 16, fontWeight: '600' },
  closeBtn: { padding: 4 },
  closeText: { color: '#8b949e', fontSize: 16 },
  scroll: { paddingHorizontal: 16 },
  section: { paddingVertical: 12 },
  sectionTitle: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  row: {
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
  rowCurrent: {
    borderColor: 'rgba(78,201,176,0.4)',
    backgroundColor: 'rgba(78,201,176,0.05)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  dotActive: { backgroundColor: '#4ec9b0' },
  dotIdle: { backgroundColor: '#dcdcaa' },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
  rowPath: { color: '#8b949e', fontSize: 11, fontFamily: 'monospace' },
  currentBadge: { color: '#4ec9b0', fontSize: 11, fontWeight: '600' },
  arrow: { color: '#8b949e', fontSize: 14 },
  newSessionBtn: {
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
  newSessionIcon: { color: '#4ec9b0', fontSize: 18, lineHeight: 20 },
  newSessionText: { color: '#4ec9b0', fontSize: 14, fontWeight: '600' },
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
  projectLeft: { flex: 1, gap: 3 },
  projectName: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
  projectPath: { color: '#8b949e', fontSize: 11, fontFamily: 'monospace' },
  projectDate: { color: '#8b949e', fontSize: 11, flexShrink: 0 },
})
