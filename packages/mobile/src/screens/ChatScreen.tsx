import React, { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ProjectInfo, SessionInfo, SessionSource, WsMessage } from '@remocoder/shared'
import { PermissionSheet, PermissionRequest } from '../components/PermissionSheet'
import { SessionSwitcherModal } from '../components/SessionSwitcherModal'
import { useWebSocket, ConnectionStatus } from '../hooks/useWebSocket'

// ─── チャットアイテム型 ────────────────────────────────────────────────────────

// id なしのデータ部分（Omit<Union, key> は分配されないため個別定義）
type ChatItemData =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'tool_use'; toolName: string; toolInput: string }
  | { kind: 'tool_result'; toolName: string; content: string; isError: boolean }
  | { kind: 'system'; content: string }

type ChatItem = ChatItemData & { id: string }

let _idCounter = 0
function nextId() { return String(++_idCounter) }

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  ip: string
  token: string
  projectPath?: string | null
  /** アタッチする既存セッションID。指定時は projectPath より優先 */
  sessionId?: string | null
  onDisconnect: () => void
}

// ─── ステータスバー設定 ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string; bgColor: string }> = {
  connecting:   { label: '接続中...',     color: '#d4d4d4', bgColor: 'rgba(100,100,100,0.8)' },
  connected:    { label: '接続済み',      color: '#4ec9b0', bgColor: 'rgba(0,80,60,0.8)' },
  reconnecting: { label: '再接続中...',   color: '#dcdcaa', bgColor: 'rgba(80,70,0,0.8)' },
  auth_error:   { label: '認証エラー',    color: '#f44747', bgColor: 'rgba(80,0,0,0.8)' },
  disconnected: { label: 'セッション終了', color: '#d4d4d4', bgColor: 'rgba(50,50,50,0.8)' },
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export function ChatScreen({ ip, token, projectPath, sessionId, onDisconnect }: Props) {
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [inputText, setInputText] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [switcherLoading, setSwitcherLoading] = useState(false)
  const [sessionList, setSessionList] = useState<SessionInfo[]>([])
  const [projectList, setProjectList] = useState<ProjectInfo[]>([])
  const listRef = useRef<FlatList<ChatItem>>(null)

  const addMessage = useCallback((item: ChatItemData) => {
    const msg = { ...item, id: nextId() } as ChatItem
    setMessages((prev) => [...prev, msg])
  }, [])

  // send が useWebSocket より後に定義されるため ref 経由で参照する
  const sendRef = useRef<(msg: WsMessage) => void>(() => {})
  const sessionCreatedRef = useRef(false)

  const handleMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'auth_ok':
        // 認証成功後にセッションを作成 / アタッチする
        if (!sessionCreatedRef.current) {
          sessionCreatedRef.current = true
          if (sessionId) {
            sendRef.current({ type: 'session_attach', sessionId })
          } else {
            const source: SessionSource = projectPath
              ? { kind: 'claude', projectPath }
              : { kind: 'claude' }
            sendRef.current({ type: 'session_create', source })
          }
        }
        break

      case 'session_attached':
        setCurrentSessionId(msg.sessionId)
        setIsThinking(false)
        setPendingPermission(null)
        setSwitcherLoading(false)
        setShowSwitcher(false)
        if (msg.source?.kind !== 'claude') {
          addMessage({ kind: 'system', content: `セッションに接続しました: ${msg.sessionId.slice(0, 8)}` })
        }
        break

      case 'chat_ready':
        addMessage({ kind: 'system', content: `claude 起動完了 (${msg.cwd})` })
        break

      case 'chat_assistant_message':
        setIsThinking(false)
        addMessage({ kind: 'assistant', content: msg.content })
        break

      case 'chat_tool_use':
        addMessage({ kind: 'tool_use', toolName: msg.toolName, toolInput: msg.toolInput })
        break

      case 'chat_tool_result':
        addMessage({ kind: 'tool_result', toolName: msg.toolName, content: msg.content, isError: msg.isError })
        break

      case 'chat_status':
        if (msg.status === 'idle') setIsThinking(false)
        break

      case 'permission_request':
        setPendingPermission({
          requestId: msg.requestId,
          toolName: msg.toolName,
          details: msg.details,
          requiresAlways: msg.requiresAlways,
        })
        break

      case 'session_list_response':
        setSessionList(msg.sessions)
        setProjectList(msg.projects)
        setSwitcherLoading(false)
        setShowSwitcher(true)
        break

      case 'session_not_found':
        addMessage({ kind: 'system', content: `セッションが見つかりません: ${msg.sessionId}` })
        setSwitcherLoading(false)
        setShowSwitcher(false)
        break

      case 'shell_exit':
        addMessage({ kind: 'system', content: `セッションが終了しました (exit code: ${msg.exitCode})` })
        setIsThinking(false)
        break
    }
  }, [addMessage, sessionId, projectPath])

  const { send, status } = useWebSocket({ ip, token, onMessage: handleMessage })
  // sendRef を常に最新の send に向ける
  sendRef.current = send

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text || status !== 'connected') return

    addMessage({ kind: 'user', content: text })
    setInputText('')
    setIsThinking(true)
    // PTY の stdin にテキストを送る（末尾改行でエンター）
    send({ type: 'input', data: text + '\n' })
  }, [inputText, status, addMessage, send])

  const handlePermissionDecide = useCallback((requestId: string, decision: 'approve' | 'reject' | 'always') => {
    setPendingPermission(null)
    send({ type: 'permission_response', requestId, decision })
  }, [send])

  const handleOpenSwitcher = useCallback(() => {
    setSwitcherLoading(true)
    send({ type: 'session_list_request' })
  }, [send])

  const handleSwitchToSession = useCallback((sessionId: string) => {
    setSwitcherLoading(true)
    send({ type: 'session_attach', sessionId })
  }, [send])

  const handleCreateNewSession = useCallback((newProjectPath: string | null) => {
    setSwitcherLoading(true)
    const source: SessionSource = newProjectPath
      ? { kind: 'claude', projectPath: newProjectPath }
      : { kind: 'claude' }
    send({ type: 'session_create', source })
  }, [send])

  const statusCfg = STATUS_CONFIG[status]
  const showRetry = status === 'auth_error' || status === 'disconnected'
  const canSend = status === 'connected' && inputText.trim().length > 0

  // useWebSocket の onMessage を handleMessageWithSession に向ける
  // useWebSocket 内部の onMessageRef.current が最新関数を参照するため、
  // handleMessageWithSession を直接渡してもクロージャ問題はない
  // ただし useWebSocket の引数は変わらないので再接続は起きない

  return (
    <SafeAreaView style={styles.container}>
      {/* ステータスバー */}
      <View style={[styles.statusBar, { backgroundColor: statusCfg.bgColor }]} testID="status-bar">
        <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        <View style={styles.statusActions}>
          {status === 'connected' && (
            <TouchableOpacity
              testID="switcher-button"
              style={styles.actionButton}
              onPress={handleOpenSwitcher}
              disabled={switcherLoading}
            >
              {switcherLoading
                ? <ActivityIndicator size="small" color="#d4d4d4" />
                : <Text style={styles.actionButtonText}>切替</Text>
              }
            </TouchableOpacity>
          )}
          {showRetry && (
            <TouchableOpacity
              testID="retry-button"
              style={styles.actionButton}
              onPress={() => {
                sessionCreatedRef.current = false
                setMessages([])
                setIsThinking(false)
                // useWebSocket は ip/token 変更で再接続するため、ここでは
                // 親コンポーネントに委ねる。簡易再試行は切断→再接続で行う。
                onDisconnect()
              }}
            >
              <Text style={styles.actionButtonText}>再試行</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity testID="disconnect-button" style={styles.actionButton} onPress={onDisconnect}>
            <Text style={styles.actionButtonText}>切断</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* チャットリスト */}
      <FlatList
        ref={listRef}
        testID="chat-list"
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => <ChatBubble item={item} />}
      />

      {/* thinking インジケーター */}
      {isThinking && (
        <View testID="thinking-indicator" style={styles.thinkingRow}>
          <ActivityIndicator size="small" color="#4ec9b0" />
          <Text style={styles.thinkingText}>思考中...</Text>
        </View>
      )}

      {/* 入力エリア */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            testID="message-input"
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="メッセージを入力..."
            placeholderTextColor="#666"
            multiline
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
            editable={status === 'connected'}
          />
          <TouchableOpacity
            testID="send-button"
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend}
          >
            <Text style={styles.sendButtonText}>送信</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

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

// ─── チャットバブル ────────────────────────────────────────────────────────────

function ChatBubble({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <View style={styles.userBubbleWrapper}>
          <View style={styles.userBubble} testID="bubble-user">
            <Text style={styles.userText}>{item.content}</Text>
          </View>
        </View>
      )

    case 'assistant':
      return (
        <View style={styles.assistantBubble} testID="bubble-assistant">
          <Text style={styles.assistantText}>{item.content}</Text>
        </View>
      )

    case 'tool_use':
      return (
        <View style={styles.toolCard} testID="bubble-tool-use">
          <Text style={styles.toolName}>⚙ {item.toolName}</Text>
          <Text style={styles.toolInput} numberOfLines={6}>{item.toolInput}</Text>
        </View>
      )

    case 'tool_result':
      return (
        <View style={[styles.toolResultCard, item.isError && styles.toolResultError]} testID="bubble-tool-result">
          <Text style={styles.toolResultText} numberOfLines={8}>{item.content}</Text>
        </View>
      )

    case 'system':
      return (
        <View style={styles.systemRow} testID="bubble-system">
          <Text style={styles.systemText}>{item.content}</Text>
        </View>
      )
  }
}

// ─── スタイル ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1e1e1e' },

  // ステータスバー
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: { fontSize: 12, fontWeight: '600' },
  statusActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: { color: '#d4d4d4', fontSize: 12 },

  // チャットリスト
  listContent: { padding: 12, gap: 8 },

  // thinking
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  thinkingText: { color: '#4ec9b0', fontSize: 12 },

  // 入力エリア
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#333',
    backgroundColor: '#252526',
  },
  input: {
    flex: 1,
    color: '#d4d4d4',
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#3c3c3c',
  },
  sendButton: {
    backgroundColor: '#0e7afb',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#333' },
  sendButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // ユーザーバブル
  userBubbleWrapper: { alignItems: 'flex-end' },
  userBubble: {
    backgroundColor: '#0e7afb',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '80%',
  },
  userText: { color: '#fff', fontSize: 14 },

  // アシスタントバブル
  assistantBubble: {
    backgroundColor: '#2d2d2d',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: '90%',
  },
  assistantText: { color: '#d4d4d4', fontSize: 14, lineHeight: 20 },

  // ツールカード
  toolCard: {
    backgroundColor: '#1f2d1f',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4ec9b0',
    padding: 10,
  },
  toolName: { color: '#4ec9b0', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  toolInput: {
    color: '#9cdcfe',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ツール結果カード
  toolResultCard: {
    backgroundColor: '#252526',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#569cd6',
    padding: 10,
  },
  toolResultError: { borderLeftColor: '#f44747', backgroundColor: '#2d1f1f' },
  toolResultText: {
    color: '#d4d4d4',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // システムメッセージ
  systemRow: { alignItems: 'center', paddingVertical: 4 },
  systemText: { color: '#666', fontSize: 11 },
})
