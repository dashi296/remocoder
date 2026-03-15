/**
 * Claude Code SDK セッション用 WebSocket フック
 *
 * - 認証・セッション作成/アタッチ
 * - cc_* メッセージをチャットアイテムとして蓄積
 * - ユーザーメッセージ送信・承認応答
 * - 再接続ロジック
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { DEFAULT_WS_PORT, WsMessage, SessionSource, SessionInfo, ProjectInfo } from '@remocoder/shared'

// ──────────────────────────────────────────────────────────────────────────────
// チャットアイテム型
// ──────────────────────────────────────────────────────────────────────────────

export type ChatItem =
  | { kind: 'user'; id: string; content: string }
  | { kind: 'assistant'; id: string; content: string }
  | { kind: 'tool_use'; id: string; toolUseId: string; toolName: string; input: unknown }
  | { kind: 'tool_result'; id: string; toolUseId: string; content: string; isError: boolean }
  | {
      kind: 'permission'
      id: string
      permissionId: string
      toolName: string
      input: unknown
      prompt: string
      responded: boolean
      approved?: boolean
    }

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'auth_error' | 'ended'

interface UseCcWebSocketOptions {
  ip: string
  token: string
  projectPath?: string | null
  sessionId?: string | null
  source?: SessionSource | null
}

interface UseCcWebSocketReturn {
  status: ConnectionStatus
  items: ChatItem[]
  currentSessionId: string | null
  sessionList: SessionInfo[]
  projectList: ProjectInfo[]
  sendMessage: (content: string) => void
  respondPermission: (permissionId: string, approved: boolean) => void
  switchSession: (sessionId: string) => void
  createSession: (projectPath: string | null) => void
}

// ──────────────────────────────────────────────────────────────────────────────
// フック本体
// ──────────────────────────────────────────────────────────────────────────────

export function useCcWebSocket({
  ip,
  token,
  projectPath,
  sessionId: initialSessionId,
  source,
}: UseCcWebSocketOptions): UseCcWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [items, setItems] = useState<ChatItem[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessionList, setSessionList] = useState<SessionInfo[]>([])
  const [projectList, setProjectList] = useState<ProjectInfo[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(1000)
  const noReconnectRef = useRef(false)
  const idCounterRef = useRef(0)
  const mountedRef = useRef(true)

  const nextId = () => String(++idCounterRef.current)

  const addItem = useCallback((item: ChatItem) => {
    setItems((prev) => [...prev, item])
  }, [])

  const sendWs = useCallback((msg: WsMessage) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  const buildSessionCreate = useCallback((): WsMessage => {
    if (source) {
      return { type: 'session_create', source }
    }
    return { type: 'session_create', projectPath: projectPath ?? undefined }
  }, [source, projectPath])

  const handleMessage = useCallback(
    (raw: string) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }

      switch (msg.type) {
        case 'auth_ok':
          // auth_ok 後はセッション作成 or アタッチ
          if (initialSessionId) {
            sendWs({ type: 'session_attach', sessionId: initialSessionId })
          } else {
            sendWs(buildSessionCreate())
          }
          break

        case 'auth_error':
          setStatus('auth_error')
          noReconnectRef.current = true
          break

        case 'session_attached':
          currentSessionIdRef.current = msg.sessionId
          setCurrentSessionId(msg.sessionId)
          setStatus('connected')
          reconnectDelayRef.current = 1000
          break

        case 'session_not_found':
          setStatus('auth_error')
          noReconnectRef.current = true
          break

        case 'session_list_response':
          setSessionList(msg.sessions)
          setProjectList(msg.projects)
          break

        case 'cc_message':
          addItem({ kind: 'assistant', id: msg.id, content: msg.content })
          break

        case 'cc_tool_use':
          addItem({
            kind: 'tool_use',
            id: nextId(),
            toolUseId: msg.toolUseId,
            toolName: msg.toolName,
            input: msg.input,
          })
          break

        case 'cc_tool_result':
          addItem({
            kind: 'tool_result',
            id: nextId(),
            toolUseId: msg.toolUseId,
            content: msg.content,
            isError: msg.isError,
          })
          break

        case 'cc_permission_request':
          addItem({
            kind: 'permission',
            id: nextId(),
            permissionId: msg.permissionId,
            toolName: msg.toolName,
            input: msg.input,
            prompt: msg.prompt,
            responded: false,
          })
          break

        case 'cc_session_end':
          setStatus('ended')
          noReconnectRef.current = true
          break
      }
    },
    [initialSessionId, buildSessionCreate, sendWs, addItem],
  )

  // 再接続時も最新の handleMessage を参照できるよう ref 経由で呼ぶ
  const handleMessageRef = useRef(handleMessage)
  handleMessageRef.current = handleMessage

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    const url = `ws://${ip}:${DEFAULT_WS_PORT}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      // onopen 時点の ws インスタンスに直接送信し、古い ref を参照しない
      ws.send(JSON.stringify({ type: 'auth', token } satisfies WsMessage))
    }

    // handleMessageRef 経由で呼ぶことで、再接続後も最新のクロージャを使用する
    ws.onmessage = (e) => handleMessageRef.current(e.data)

    ws.onclose = () => {
      if (!mountedRef.current || noReconnectRef.current) return
      setStatus('reconnecting')
      const delay = Math.min(reconnectDelayRef.current, 30000)
      reconnectDelayRef.current = delay * 2
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      // onclose が続けて呼ばれるため、ここでは何もしない
    }
  }, [ip, token])

  useEffect(() => {
    mountedRef.current = true
    noReconnectRef.current = false
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
    // connect は初回のみ実行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 公開操作 ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    (content: string) => {
      const sid = currentSessionIdRef.current
      if (!sid) return
      addItem({ kind: 'user', id: nextId(), content })
      sendWs({ type: 'cc_user_input', content, sessionId: sid })
    },
    [sendWs, addItem],
  )

  const respondPermission = useCallback(
    (permissionId: string, approved: boolean) => {
      const sid = currentSessionIdRef.current
      if (!sid) return
      setItems((prev) =>
        prev.map((item) =>
          item.kind === 'permission' && item.permissionId === permissionId
            ? { ...item, responded: true, approved }
            : item,
        ),
      )
      sendWs({ type: 'cc_permission_response', permissionId, approved, sessionId: sid })
    },
    [sendWs],
  )

  const switchSession = useCallback(
    (targetSessionId: string) => {
      sendWs({ type: 'session_attach', sessionId: targetSessionId })
      setItems([])
    },
    [sendWs],
  )

  const createSession = useCallback(
    (newProjectPath: string | null) => {
      sendWs({ type: 'session_create', projectPath: newProjectPath ?? undefined })
      setItems([])
    },
    [sendWs],
  )

  return {
    status,
    items,
    currentSessionId,
    sessionList,
    projectList,
    sendMessage,
    respondPermission,
    switchSession,
    createSession,
  }
}
