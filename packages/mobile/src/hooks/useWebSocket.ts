import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_WS_PORT, WsMessage } from '@remocoder/shared'

// 接続試行タイムアウト（ms）
const CONNECT_TIMEOUT = 10000
// 最大再接続遅延（ms）
const MAX_RECONNECT_DELAY = 30000
// キープアライブ間隔（ms）
const KEEPALIVE_INTERVAL = 30000

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'auth_error' | 'disconnected'

export interface UseWebSocketOptions {
  ip: string
  token: string
  onMessage: (msg: WsMessage) => void
}

export interface UseWebSocketResult {
  send: (msg: WsMessage) => void
  status: ConnectionStatus
}

/**
 * ネイティブ WebSocket を使った接続管理フック。
 * 認証・再接続・ping/pong キープアライブを担当する。
 * 認証後の session_create などの高レベルなフローは呼び出し元が担当する。
 */
export function useWebSocket({ ip, token, onMessage }: UseWebSocketOptions): UseWebSocketResult {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  // 最新の onMessage を ref で保持（再レンダリングで再接続させない）
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelayRef = useRef(1000)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 認証エラー・セッション終了後は自動再接続しない
  const noReconnectRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null }
    if (connectTimerRef.current) { clearTimeout(connectTimerRef.current); connectTimerRef.current = null }
    if (keepaliveTimerRef.current) { clearInterval(keepaliveTimerRef.current); keepaliveTimerRef.current = null }
  }, [])

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  useEffect(() => {
    noReconnectRef.current = false
    reconnectDelayRef.current = 1000

    function connect() {
      if (noReconnectRef.current) return

      clearTimers()
      setStatus('connecting')

      const ws = new WebSocket(`ws://${ip}:${DEFAULT_WS_PORT}`)
      wsRef.current = ws

      // 接続タイムアウト
      connectTimerRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      }, CONNECT_TIMEOUT)

      ws.onopen = () => {
        if (connectTimerRef.current) { clearTimeout(connectTimerRef.current); connectTimerRef.current = null }
        reconnectDelayRef.current = 1000
        ws.send(JSON.stringify({ type: 'auth', token } satisfies WsMessage))
      }

      ws.onmessage = (e: MessageEvent) => {
        let msg: WsMessage
        try {
          msg = JSON.parse(e.data as string)
        } catch {
          return
        }

        if (msg.type === 'auth_ok') {
          setStatus('connected')
          // キープアライブ開始
          keepaliveTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' } satisfies WsMessage))
            }
          }, KEEPALIVE_INTERVAL)
        } else if (msg.type === 'auth_error') {
          noReconnectRef.current = true
          setStatus('auth_error')
        } else if (msg.type === 'shell_exit') {
          noReconnectRef.current = true
          setStatus('disconnected')
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' } satisfies WsMessage))
        }

        onMessageRef.current(msg)
      }

      ws.onclose = () => {
        clearTimers()
        if (noReconnectRef.current) return

        setStatus('reconnecting')
        const delay = reconnectDelayRef.current
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY)
          connect()
        }, delay)
      }

      ws.onerror = () => {
        // onclose が続けて呼ばれるので再接続はそちらで処理
      }
    }

    connect()

    return () => {
      noReconnectRef.current = true
      clearTimers()
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [ip, token, clearTimers])

  return { send, status }
}
