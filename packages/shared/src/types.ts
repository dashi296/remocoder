export const MULTIPLEXER_KINDS = ['tmux', 'screen', 'zellij', 'herdr', 'herdr-core'] as const
export type MultiplexerKind = (typeof MULTIPLEXER_KINDS)[number]

/**
 * SGR マウスホイールシーケンスを自身のスクロール操作として解釈するマルチプレクサ。
 * herdr-core (`hc attach`) はホイールシーケンスをそのままプログラムへ渡すため含めない。
 */
export const SGR_SCROLL_MULTIPLEXER_KINDS: readonly MultiplexerKind[] = ['tmux', 'screen', 'zellij', 'herdr']

/** herdr-core が OSC 7501 で報告するエージェント状態 */
export const AGENT_STATUSES = ['idle', 'working', 'done', 'blocked', 'error'] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && (AGENT_STATUSES as readonly string[]).includes(value)
}

export function isMultiplexerKind(kind: string): kind is MultiplexerKind {
  return (MULTIPLEXER_KINDS as readonly string[]).includes(kind)
}

/** auth メッセージで宣言するクライアント機能 */
export type ClientCapability = 'session_error'

/** PTYセッションの起動元を表す型 */
export type SessionSource =
  | { kind: 'claude'; projectPath?: string }
  | { kind: MultiplexerKind; sessionName: string }
  | { kind: 'shell'; cwd?: string }

export type MultiplexerSource = Extract<SessionSource, { sessionName: string }>

export function isMultiplexerSource(source: SessionSource): source is MultiplexerSource {
  return isMultiplexerKind(source.kind)
}

/** マルチプレクサのセッション情報 */
export interface MultiplexerSessionInfo {
  tool: MultiplexerKind
  sessionName: string
  /** セッションの追加情報（例: ウィンドウ数、状態） */
  detail?: string
  /** セッションのカレントディレクトリ */
  workingDirectory?: string
  /** 内部で動作しているエージェント/プログラム名（例: claude-code, zsh）。herdr-core のみ */
  agent?: string
  /** エージェント自身が報告した状態。報告がなければ undefined。herdr-core のみ */
  agentStatus?: AgentStatus
  /** 状態に付随するメッセージ（例: 完了内容の要約）。herdr-core のみ */
  agentStatusMessage?: string
}

/** WebSocketメッセージの型定義 */
export type WsMessage =
  | { type: 'input'; data: string }
  | { type: 'output'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }
  | { type: 'pong' }
  /** capabilities: クライアントが解釈できる追加機能（古いクライアントは送らない） */
  | { type: 'auth'; token: string; capabilities?: ClientCapability[] }
  | { type: 'auth_ok'; serverName: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'shell_exit'; exitCode: number }
  /**
   * セッションの作成・起動に失敗した（不正なソース、PTY 起動失敗、herdr-core 停止中など）。
   * 認証は有効なまま。capabilities に 'session_error' を含むクライアントにだけ送り、
   * それ以外の（古い）クライアントには従来どおり auth_error を送る
   */
  | { type: 'session_error'; reason: string }
  | { type: 'session_list'; sessions: SessionInfo[]; multiplexerSessions?: MultiplexerSessionInfo[] }
  /** projectPath は後方互換のために保持。source が優先される */
  | { type: 'session_create'; projectPath?: string; source?: SessionSource }
  | { type: 'session_attach'; sessionId: string }
  | { type: 'session_attached'; sessionId: string; scrollback: string; source?: SessionSource }
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
  /** デスクトップがモバイルへ承認プロンプトを通知する */
  | { type: 'permission_request'; requestId: string; toolName: string; details: string[]; requiresAlways: boolean; createdAt: number }
  /** モバイルがデスクトップへ承認結果を返す */
  | { type: 'permission_response'; requestId: string; decision: 'approve' | 'reject' | 'always' }
  /** モバイルがスラッシュコマンド一覧を要求する */
  | { type: 'command_list_request' }
  /** command_list_request への応答 */
  | {
      type: 'command_list'
      sessionId: string | null
      commands: SlashCommandInfo[]
      truncated?: boolean
      error?: string
    }
  /** モバイルがデスクトップへセッション削除を要求する */
  | { type: 'session_delete'; sessionId: string }
  /** session_delete への応答（削除完了） */
  | { type: 'session_deleted'; sessionId: string }

/** スラッシュコマンド（コマンド定義またはスキル）の情報 */
export interface SlashCommandInfo {
  /** 呼び出し名（先頭の / は含まない）。例: "commit", "commit-commands:commit" */
  name: string
  /** frontmatter の description。デスクトップ側で 120 文字に切り詰め済み */
  description?: string
  /** 提供元 */
  scope: 'builtin' | 'user' | 'project' | 'plugin'
  /** 表示用の名前空間注記。例: "project:ci"。呼び出し名には含まれない */
  namespace?: string
  /** scope が 'plugin' のときの plugin.json の name */
  pluginName?: string
}

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
  /** PTYへの最終出力時刻 (ISO 8601) */
  lastActiveAt?: string
  /** PTYの最終出力行（ANSI除去済み、最大80文字） */
  lastOutputLine?: string
  /** Claudeの処理フェーズ推定 */
  claudePhase?: 'thinking' | 'writing' | 'waiting' | 'idle'
}

export const DEFAULT_WS_PORT = 8080

export function sessionProjectName(session: SessionInfo): string | undefined {
  const path =
    (session.source?.kind === 'claude' ? session.source.projectPath : undefined) ??
    session.projectPath
  if (!path) return undefined
  return path.split(/[/\\]/).filter(Boolean).pop()
}

export function formatSessionElapsed(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h} hr ago`
}

export function sessionSourceIcon(source?: SessionSource): string {
  if (!source) return '🖥'
  switch (source.kind) {
    case 'claude': return '🤖'
    case 'shell':  return '🐚'
    case 'tmux':   return '📟'
    case 'screen': return '🖥'
    case 'zellij': return '🪟'
    case 'herdr':  return '🐑'
    case 'herdr-core': return '🐏'
    default: {
      const _exhaustive: never = source
      return '🖥'
    }
  }
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
