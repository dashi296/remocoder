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

export interface SessionInfo {
  id: string
  createdAt: string
  status: 'active' | 'idle'
  clientIP?: string
}

export const DEFAULT_WS_PORT = 8080
