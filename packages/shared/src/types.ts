// WebSocketメッセージの型定義
export type WsMessage =
  | { type: 'input'; data: string }
  | { type: 'output'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'auth'; token: string }
  | { type: 'auth_ok' }
  | { type: 'auth_error'; reason: string }
  | { type: 'shell_exit'; exitCode: number }
  | { type: 'session_list'; sessions: SessionInfo[] }
  | { type: 'session_create' }
  | { type: 'session_attach'; sessionId: string }
  | { type: 'session_attached'; sessionId: string; scrollback: string }
  | { type: 'session_not_found'; sessionId: string }

export interface SessionInfo {
  id: string
  createdAt: string
  status: 'active' | 'idle'
  clientIP?: string
  /** モバイルWSクライアントが接続中かどうか */
  hasClient?: boolean
}

export const DEFAULT_WS_PORT = 8080
