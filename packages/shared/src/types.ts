/** PTYセッションの起動元を表す型 */
export type SessionSource =
  | { kind: 'claude'; projectPath?: string }
  | { kind: 'tmux'; sessionName: string }
  | { kind: 'screen'; sessionName: string }
  | { kind: 'zellij'; sessionName: string }
  | { kind: 'shell'; cwd?: string }

/** tmux / screen / zellij のセッション情報 */
export interface MultiplexerSessionInfo {
  tool: 'tmux' | 'screen' | 'zellij'
  sessionName: string
  /** セッションの追加情報（例: ウィンドウ数、状態） */
  detail?: string
}

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
  | { type: 'session_list'; sessions: SessionInfo[]; multiplexerSessions?: MultiplexerSessionInfo[] }
  /** projectPath は後方互換のために保持。source が優先される */
  | { type: 'session_create'; projectPath?: string; source?: SessionSource }
  | { type: 'session_attach'; sessionId: string }
  | { type: 'session_attached'; sessionId: string; scrollback: string }
  | { type: 'session_not_found'; sessionId: string }
  /** 外部ターミナルから PTY セッションを登録する */
  | { type: 'session_register'; cols: number; rows: number }
  /** session_register への応答 */
  | { type: 'session_registered'; sessionId: string }
  /** 認証後に送信する最近使ったプロジェクト一覧 */
  | { type: 'project_list'; projects: ProjectInfo[] }
  /** アタッチ済みクライアントがセッション一覧を要求する */
  | { type: 'session_list_request' }
  /** session_list_request への応答（セッション一覧 + 最近のプロジェクト一覧） */
  | { type: 'session_list_response'; sessions: SessionInfo[]; projects: ProjectInfo[]; multiplexerSessions?: MultiplexerSessionInfo[] }
  // ── チャットUI向け Claude Code SDK イベント ──
  | CcMessage
  | CcToolUse
  | CcToolResult
  | CcPermissionRequest
  | CcPermissionResponse
  | CcSessionStart
  | CcSessionEnd
  | CcUserInput

export interface ProjectInfo {
  /** プロジェクトのフルパス */
  path: string
  /** プロジェクト名（パスの末尾コンポーネント） */
  name: string
  /** 最終使用日時 (ISO 8601) */
  lastUsedAt: string
}

export interface SessionInfo {
  id: string
  createdAt: string
  status: 'active' | 'idle'
  clientIP?: string
  /** モバイルWSクライアントが接続中かどうか */
  hasClient?: boolean
  /** 外部ターミナルから登録されたセッションかどうか */
  isExternal?: boolean
  /** セッションが起動したプロジェクトパス */
  projectPath?: string
  /** セッションの起動元 */
  source?: SessionSource
}

export const DEFAULT_WS_PORT = 8080

// ──────────────────────────────────────────────
// チャットUI向け Claude Code SDK イベント型
// ──────────────────────────────────────────────

/** Claude Code SDK が発行するメッセージのロール */
export type CcRole = 'assistant' | 'user'

/** アシスタントのテキスト返答 */
export interface CcMessage {
  type: 'cc_message'
  id: string
  role: CcRole
  content: string
  sessionId: string
}

/** ツール実行リクエスト（Claude → ツール） */
export interface CcToolUse {
  type: 'cc_tool_use'
  toolUseId: string
  toolName: string
  input: unknown
  sessionId: string
}

/** ツール実行結果（ツール → Claude） */
export interface CcToolResult {
  type: 'cc_tool_result'
  toolUseId: string
  content: string
  isError: boolean
  sessionId: string
}

/** ユーザーによる承認が必要なリクエスト */
export interface CcPermissionRequest {
  type: 'cc_permission_request'
  permissionId: string
  toolName: string
  input: unknown
  /** ユーザーに表示するプロンプト文字列 */
  prompt: string
  sessionId: string
}

/** Mobile → Desktop: 承認/拒否の応答 */
export interface CcPermissionResponse {
  type: 'cc_permission_response'
  permissionId: string
  approved: boolean
  sessionId: string
}

/** Claude Code SDK セッション開始通知 */
export interface CcSessionStart {
  type: 'cc_session_start'
  sessionId: string
}

/** Claude Code SDK セッション終了通知 */
export interface CcSessionEnd {
  type: 'cc_session_end'
  sessionId: string
  exitCode?: number
}

/** Mobile → Desktop: ユーザーメッセージ送信 */
export interface CcUserInput {
  type: 'cc_user_input'
  content: string
  sessionId: string
}

/** スリープ抑制設定 */
export interface PowerSettings {
  /** AC電源（充電中）のときにスリープを抑制する */
  preventSleepOnAC: boolean
  /** バッテリー駆動中にスリープを抑制する */
  preventSleepOnBattery: boolean
}

/** デスクトップアプリの自動アップデート情報 */
export interface UpdateInfo {
  /** 新しいバージョン文字列 (semver) */
  readonly version: string
  /** 現在のメジャーバージョンより大きい場合 true（モバイルとの互換性確認が必要） */
  readonly isMajor: boolean
}
