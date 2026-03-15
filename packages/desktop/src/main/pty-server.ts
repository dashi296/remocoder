import * as pty from 'node-pty'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { WsMessage, SessionInfo, ProjectInfo, MultiplexerSessionInfo, SessionSource, DEFAULT_WS_PORT } from '@remocoder/shared'
import { v4 as uuidv4 } from 'uuid'
import { tryParsePermission, stripAnsi } from './permission-parser'

const execAsync = promisify(exec)

let AUTH_TOKEN = process.env.REMOTE_TOKEN ?? uuidv4()

// ─── Claude プロジェクト一覧取得 ───────────────────────────────────────────────

/**
 * ~/.claude/projects/ のディレクトリ名をファイルシステムを実際にたどって復元する。
 * Claude のエンコード形式: '/' を '-' に置換。
 * パスコンポーネント自体に '-' が含まれる場合（例: my-project）も対応するため、
 * 各セグメントでファイルシステムの存在確認を行いながらグリーディに解決する。
 */
export function decodeProjectPath(encodedName: string): string {
  const parts = encodedName.slice(1).split('-')

  // Claude のエンコード: '/' → '-', '_' → '-' の両方を行う。
  // そのため '-' は '/', '-', '_' のいずれかを表す可能性がある。
  // バックトラッキングで「実際に存在するパス」を探し、
  // かつセグメント内の '-' を '_' に置換したバリアントも試みる。
  function existsWithVariants(dir: string, segment: string): string | null {
    const positions = [...segment.matchAll(/-/g)].map((m) => m.index!)
    for (let mask = 0; mask < 1 << positions.length; mask++) {
      let variant = segment
      for (let j = 0; j < positions.length; j++) {
        if (mask & (1 << j)) {
          variant = variant.slice(0, positions[j]) + '_' + variant.slice(positions[j] + 1)
        }
      }
      const candidate = dir + '/' + variant
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  function search(i: number, pathSoFar: string): string | null {
    for (let len = 1; len <= parts.length - i; len++) {
      const segment = parts.slice(i, i + len).join('-')
      if (i + len === parts.length) {
        return existsWithVariants(pathSoFar, segment)
      }
      const candidate = existsWithVariants(pathSoFar, segment)
      if (candidate !== null) {
        const result = search(i + len, candidate)
        if (result !== null) return result
      }
    }
    return null
  }

  return search(0, '') ?? ('/' + encodedName.slice(1).replace(/-/g, '/'))
}

/** getRecentProjects のキャッシュ（5秒TTL） */
let projectsCache: { value: ProjectInfo[]; expiry: number } | null = null

/** ~/.claude/projects/ から最近使ったプロジェクト一覧を取得する */
export function getRecentProjects(limit = 20): ProjectInfo[] {
  const now = Date.now()
  if (projectsCache && now < projectsCache.expiry) return projectsCache.value

  const claudeDir = join(homedir(), '.claude', 'projects')
  try {
    const entries = readdirSync(claudeDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('-'))

    const projects: ProjectInfo[] = entries
      .map((d) => {
        const projectPath = decodeProjectPath(d.name)
        if (!existsSync(projectPath)) return null
        const name = projectPath.split('/').filter(Boolean).pop() ?? d.name
        const mtime = statSync(join(claudeDir, d.name)).mtime
        return { path: projectPath, name, lastUsedAt: mtime.toISOString() }
      })
      .filter((p): p is ProjectInfo => p !== null)

    const value = projects
      .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
      .slice(0, limit)

    projectsCache = { value, expiry: now + 5000 }
    return value
  } catch {
    return []
  }
}

export function initToken(token: string) {
  AUTH_TOKEN = token
}

export function rotateToken(): string {
  AUTH_TOKEN = uuidv4()
  console.log(`Auth token rotated: ${AUTH_TOKEN}`)
  return AUTH_TOKEN
}

// サーバーからクライアントへのping間隔（ms）
const SERVER_PING_INTERVAL = 30000
// pong未応答タイムアウト（ms）
const PONG_TIMEOUT = 10000
// アイドル判定時間（ms）
const IDLE_TIMEOUT = 300000
// スクロールバックの最大バイト数（500KB）
const SCROLLBACK_MAX_BYTES = 500_000
// アイドルタイマーを再スケジュールするまでの最小間隔（ms）
const IDLE_TIMER_RESET_INTERVAL = 5000

/** サーバー内部で管理するPTYセッション */
interface PtySession {
  id: string
  /** ローカルPTYプロセス（外部セッションの場合は null） */
  pty: pty.IPty | null
  /** 外部ターミナルからのWSプロバイダー接続（外部セッションの場合のみ設定） */
  providerWs: WebSocket | null
  createdAt: string
  status: 'active' | 'idle'
  /** PTY出力履歴チャンク（最大SCROLLBACK_MAX_BYTES） */
  scrollbackChunks: string[]
  scrollbackLength: number
  /** 接続中のモバイルWSクライアント（1台のみ） */
  wsClient: WebSocket | null
  clientIP?: string
  idleTimeoutId: ReturnType<typeof setTimeout> | null
  /** アイドルタイマーを最後にリセットした時刻（デバウンス用） */
  lastActiveAt: number
  /** セッションが起動したプロジェクトパス */
  projectPath?: string
  /** セッションの起動元 */
  source?: SessionSource
  /** 承認プロンプト検出用の直近出力バッファ（ANSIなし、上限2KB） */
  permissionBuffer: string
  /** 承認待ちリクエスト（存在する間は重複検出しない） */
  pendingPermission: { requestId: string; timeoutId: ReturnType<typeof setTimeout>; style: 'numbered' | 'legacy'; requiresAlways: boolean } | null
}

/** 永続PTYセッションマップ（WS切断後も保持） */
const ptySessions = new Map<string, PtySession>()

export interface PtyServerCallbacks {
  onSessionsChange?: (sessions: SessionInfo[]) => void
  /** デスクトップRenderer向けPTY出力通知 */
  onPtyOutput?: (sessionId: string, data: string) => void
  /** デスクトップRenderer向けPTY終了通知 */
  onPtyExit?: (sessionId: string, exitCode: number) => void
}

let serverCallbacks: PtyServerCallbacks = {}

function notifySessions() {
  const infos = getSessionInfos()
  serverCallbacks.onSessionsChange?.(infos)
}

function getSessionInfos(): SessionInfo[] {
  return Array.from(ptySessions.values()).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    status: s.status,
    clientIP: s.clientIP,
    hasClient: s.wsClient !== null && s.wsClient.readyState === WebSocket.OPEN,
    isExternal: s.pty === null,
    projectPath: s.projectPath,
    source: s.source,
  }))
}

/** スクロールバックにデータを追記し、上限を超えた場合は先頭チャンクから切り捨てる */
function appendScrollback(session: PtySession, data: string): void {
  session.scrollbackChunks.push(data)
  session.scrollbackLength += data.length
  while (session.scrollbackLength > SCROLLBACK_MAX_BYTES) {
    const removed = session.scrollbackChunks.shift()!
    session.scrollbackLength -= removed.length
  }
}

/** スクロールバック全体を文字列として返す */
function getScrollback(session: PtySession): string {
  return session.scrollbackChunks.join('')
}

/** セッションのPTYまたはプロバイダーWSへ入力を送る */
function sessionWrite(session: PtySession, data: string): void {
  if (session.pty) {
    session.pty.write(data)
  } else if (session.providerWs?.readyState === WebSocket.OPEN) {
    session.providerWs.send(JSON.stringify({ type: 'input', data } satisfies WsMessage))
  }
}

/** セッションのPTYまたはプロバイダーWSをリサイズする */
function sessionResize(session: PtySession, cols: number, rows: number): void {
  if (session.pty) {
    session.pty.resize(cols, rows)
  } else if (session.providerWs?.readyState === WebSocket.OPEN) {
    session.providerWs.send(JSON.stringify({ type: 'resize', cols, rows } satisfies WsMessage))
  }
}

// 承認プロンプトのタイムアウト（ms）
const PERMISSION_TIMEOUT = 60000

/**
 * 承認リクエストをモバイルクライアントへ送信し、タイムアウト時に自動拒否する。
 * 呼び出し前に wsClient が OPEN であることを確認すること。
 */
function sendPermissionRequest(
  session: PtySession,
  toolName: string,
  details: string[],
  requiresAlways: boolean,
  style: 'numbered' | 'legacy',
): void {
  const requestId = uuidv4()
  const timeoutId = setTimeout(() => {
    if (session.pendingPermission?.requestId === requestId) {
      const p = session.pendingPermission
      sessionWrite(session, p.style === 'numbered' ? (p.requiresAlways ? '3' : '2') : 'n\n')
      session.pendingPermission = null
      session.permissionBuffer = ''
    }
  }, PERMISSION_TIMEOUT)

  session.pendingPermission = { requestId, timeoutId, style, requiresAlways }
  session.permissionBuffer = ''
  session.wsClient!.send(
    JSON.stringify({
      type: 'permission_request',
      requestId,
      toolName,
      details,
      requiresAlways,
    } satisfies WsMessage),
  )
}

/**
 * PTY出力データから承認プロンプトを検出し、モバイルクライアントへ通知する。
 * 既に pending な承認リクエストがある場合、またはモバイルクライアントが未接続の場合は何もしない。
 */
function detectAndSendPermission(session: PtySession, data: string): void {
  if (session.pendingPermission || session.wsClient?.readyState !== WebSocket.OPEN) return

  session.permissionBuffer = (session.permissionBuffer + stripAnsi(data)).slice(-2048)

  const parsed = tryParsePermission(session.permissionBuffer)
  if (!parsed) return

  sendPermissionRequest(session, parsed.toolName, parsed.details, parsed.requiresAlways, parsed.style)
}

/**
 * セッションをアクティブ状態にし、アイドルタイマーをリセットする。
 * 高頻度呼び出しでのタイマー作り直しを抑制するため、
 * 最終リセットから IDLE_TIMER_RESET_INTERVAL 以上経過した場合のみ再スケジュールする。
 */
function setSessionActive(session: PtySession) {
  if (session.status !== 'active') {
    session.status = 'active'
    notifySessions()
  }
  const now = Date.now()
  if (now - session.lastActiveAt > IDLE_TIMER_RESET_INTERVAL) {
    if (session.idleTimeoutId) clearTimeout(session.idleTimeoutId)
    session.idleTimeoutId = setTimeout(() => {
      const s = ptySessions.get(session.id)
      if (s) {
        s.status = 'idle'
        notifySessions()
      }
    }, IDLE_TIMEOUT)
    session.lastActiveAt = now
  }
}

function createPtySession(source: SessionSource = { kind: 'claude' }, clientIP?: string): PtySession {
  const id = uuidv4()
  const ptyProc = spawnSource(source)
  const projectPath = source.kind === 'claude' ? source.projectPath : undefined

  const session: PtySession = {
    id,
    pty: ptyProc,
    providerWs: null,
    createdAt: new Date().toISOString(),
    status: 'active',
    scrollbackChunks: [],
    scrollbackLength: 0,
    wsClient: null,
    clientIP,
    idleTimeoutId: null,
    lastActiveAt: 0,
    projectPath,
    source,
    permissionBuffer: '',
    pendingPermission: null,
  }

  ptyProc.onData((data) => {
    appendScrollback(session, data)
    if (session.wsClient?.readyState === WebSocket.OPEN) {
      session.wsClient.send(JSON.stringify({ type: 'output', data } satisfies WsMessage))
    }
    serverCallbacks.onPtyOutput?.(id, data)
    detectAndSendPermission(session, data)
  })

  ptyProc.onExit(({ exitCode }) => {
    if (session.idleTimeoutId) clearTimeout(session.idleTimeoutId)
    if (session.pendingPermission) clearTimeout(session.pendingPermission.timeoutId)
    if (session.wsClient?.readyState === WebSocket.OPEN) {
      session.wsClient.send(JSON.stringify({ type: 'shell_exit', exitCode } satisfies WsMessage))
      session.wsClient.close()
    }
    serverCallbacks.onPtyExit?.(id, exitCode)
    console.log(`[pty-server] Session ${id.slice(0, 8)} exited (code: ${exitCode}). Remaining: ${ptySessions.size - 1}`)
    ptySessions.delete(id)
    notifySessions()
  })

  ptySessions.set(id, session)
  setSessionActive(session)
  notifySessions()
  console.log(`Created PTY session: ${id}`)
  return session
}

/**
 * 外部ターミナルのWSプロバイダー接続からセッションを作成する。
 * PTYはプロバイダー側で動作し、I/OはWS経由で中継される。
 */
function createExternalSession(providerWs: WebSocket): PtySession {
  const id = uuidv4()
  const session: PtySession = {
    id,
    pty: null,
    providerWs,
    createdAt: new Date().toISOString(),
    status: 'active',
    scrollbackChunks: [],
    scrollbackLength: 0,
    wsClient: null,
    idleTimeoutId: null,
    lastActiveAt: 0,
    permissionBuffer: '',
    pendingPermission: null,
  }

  ptySessions.set(id, session)
  setSessionActive(session)
  notifySessions()
  console.log(`[pty-server] Created external session: ${id}`)
  return session
}

// ─── デスクトップRenderer向けパブリックAPI ─────────────────────────────────────

/** デスクトップから新規PTYセッションを作成する */
export function desktopCreateSession(source: SessionSource = { kind: 'claude' }): string {
  // マルチプレクサの場合、同じセッションにアタッチ済みのPTYセッションがあれば再利用する
  if (source.kind === 'tmux' || source.kind === 'screen' || source.kind === 'zellij') {
    const { kind, sessionName } = source
    const existing = Array.from(ptySessions.values()).find(
      (s) => s.source?.kind === kind && (s.source as typeof source).sessionName === sessionName,
    )
    if (existing) {
      console.log(`[pty-server] Reusing existing PTY session ${existing.id.slice(0, 8)} for ${kind}:${sessionName}`)
      return existing.id
    }
  }
  return createPtySession(source).id
}

/** デスクトップからセッションのスクロールバックを取得する */
export function desktopGetScrollback(sessionId: string): string | null {
  const session = ptySessions.get(sessionId)
  return session ? getScrollback(session) : null
}

/** デスクトップからPTYへ入力を送る */
export function desktopSendInput(sessionId: string, data: string): void {
  const session = ptySessions.get(sessionId)
  if (session) {
    sessionWrite(session, data)
    setSessionActive(session)
  }
}

/** デスクトップからPTYをリサイズする */
export function desktopResize(sessionId: string, cols: number, rows: number): void {
  const session = ptySessions.get(sessionId)
  if (session) sessionResize(session, cols, rows)
}

/** 現在のセッション一覧を返す */
export function getSessions(): SessionInfo[] {
  return getSessionInfos()
}

// ─── WebSocketサーバー ──────────────────────────────────────────────────────

export function startPtyServer(port = DEFAULT_WS_PORT, callbacks: PtyServerCallbacks = {}) {
  serverCallbacks = callbacks
  const wss = new WebSocketServer({ port })

  console.log(`PTY server started on port ${port}`)
  console.log(`Auth token: ${AUTH_TOKEN}`)

  wss.on('connection', (ws, req: IncomingMessage) => {
    let authenticated = false
    let attachedSessionId: string | null = null
    /** この接続が外部ターミナルのプロバイダーとして機能しているか */
    let isProvider = false
    /** プロバイダーが管理しているセッションID */
    let providerSessionId: string | null = null
    let pongPending = false
    let pingIntervalId: ReturnType<typeof setInterval> | null = null
    let pongTimeoutId: ReturnType<typeof setTimeout> | null = null
    const clientIP = req?.socket?.remoteAddress

    const authTimeout = setTimeout(() => {
      if (!authenticated) ws.close()
    }, 5000)

    const startPingInterval = () => {
      pingIntervalId = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return
        pongPending = true
        ws.send(JSON.stringify({ type: 'ping' } satisfies WsMessage))
        pongTimeoutId = setTimeout(() => {
          if (pongPending) {
            console.log(`Session ${attachedSessionId}: pong timeout, closing connection`)
            ws.close()
          }
        }, PONG_TIMEOUT)
      }, SERVER_PING_INTERVAL)
    }

    const cleanup = () => {
      clearTimeout(authTimeout)
      if (pingIntervalId) clearInterval(pingIntervalId)
      if (pongTimeoutId) clearTimeout(pongTimeoutId)
    }

    const detachFromSession = () => {
      if (attachedSessionId) {
        const session = ptySessions.get(attachedSessionId)
        if (session && session.wsClient === ws) {
          if (session.pendingPermission) {
            clearTimeout(session.pendingPermission.timeoutId)
            const p = session.pendingPermission
            sessionWrite(session, p.style === 'numbered' ? (p.requiresAlways ? '3' : '2') : 'n\n')
            session.pendingPermission = null
          }
          session.permissionBuffer = ''
          session.wsClient = null
          session.clientIP = undefined
          notifySessions()
        }
        attachedSessionId = null
      }
    }

    ws.on('message', (raw) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        console.warn('Received malformed message, ignoring')
        return
      }

      // ── 未認証フェーズ ──────────────────────────────────────────────────
      if (!authenticated) {
        if (msg.type === 'auth' && msg.token === AUTH_TOKEN) {
          authenticated = true
          clearTimeout(authTimeout)
          startPingInterval()
          const projects = getRecentProjects()
          console.log(`[pty-server] Auth OK from ${clientIP ?? 'unknown'}. Sessions: ${ptySessions.size}, Projects: ${projects.length}`)
          ws.send(JSON.stringify({ type: 'auth_ok' } satisfies WsMessage))
          ws.send(JSON.stringify({ type: 'project_list', projects } satisfies WsMessage))
          ws.send(
            JSON.stringify({
              type: 'session_list',
              sessions: getSessionInfos(),
              multiplexerSessions: [],
            } satisfies WsMessage),
          )
          // マルチプレクサセッションは非同期で取得して追加送信する
          getMultiplexerSessions().then((multiplexerSessions) => {
            if (multiplexerSessions.length > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'session_list',
                  sessions: getSessionInfos(),
                  multiplexerSessions,
                } satisfies WsMessage),
              )
            }
          })
        } else {
          ws.send(
            JSON.stringify({ type: 'auth_error', reason: 'invalid token' } satisfies WsMessage),
          )
          ws.close()
        }
        return
      }

      // ── 外部ターミナルがセッションをプロバイダー登録する ──────────────────
      if (msg.type === 'session_register') {
        isProvider = true
        const session = createExternalSession(ws)
        providerSessionId = session.id
        console.log(`[pty-server] External session registered: ${session.id.slice(0, 8)}`)
        ws.send(JSON.stringify({ type: 'session_registered', sessionId: session.id } satisfies WsMessage))
        return
      }

      // ── 外部プロバイダーからの I/O 中継 ──────────────────────────────────
      if (isProvider && providerSessionId) {
        const provSession = ptySessions.get(providerSessionId)
        if (!provSession) return

        if (msg.type === 'output') {
          appendScrollback(provSession, msg.data)
          if (provSession.wsClient?.readyState === WebSocket.OPEN) {
            provSession.wsClient.send(JSON.stringify({ type: 'output', data: msg.data } satisfies WsMessage))
          }
          serverCallbacks.onPtyOutput?.(providerSessionId, msg.data)
          setSessionActive(provSession)
          detectAndSendPermission(provSession, msg.data)
        } else if (msg.type === 'shell_exit') {
          if (provSession.idleTimeoutId) clearTimeout(provSession.idleTimeoutId)
          if (provSession.wsClient?.readyState === WebSocket.OPEN) {
            provSession.wsClient.send(JSON.stringify({ type: 'shell_exit', exitCode: msg.exitCode } satisfies WsMessage))
            provSession.wsClient.close()
          }
          serverCallbacks.onPtyExit?.(providerSessionId, msg.exitCode)
          console.log(`[pty-server] External session ${providerSessionId.slice(0, 8)} exited (code: ${msg.exitCode})`)
          ptySessions.delete(providerSessionId)
          notifySessions()
          providerSessionId = null
        }
        return
      }

      // ── セッション選択フェーズ ─────────────────────────────────────────
      if (msg.type === 'session_create') {
        detachFromSession()
        // source が指定されていればそれを使用、なければ後方互換で claude として扱う
        const rawSource = msg.source ?? { kind: 'claude', projectPath: msg.projectPath }
        const allowedKinds = ['claude', 'tmux', 'screen', 'zellij', 'shell'] as const
        const isMultiplexer = rawSource.kind === 'tmux' || rawSource.kind === 'screen' || rawSource.kind === 'zellij'
        const isInvalid =
          !allowedKinds.includes(rawSource.kind as (typeof allowedKinds)[number]) ||
          (isMultiplexer && (typeof rawSource.sessionName !== 'string' || rawSource.sessionName.length === 0))
        if (isInvalid) {
          console.warn(`[pty-server] Rejected session_create: invalid source ${JSON.stringify(rawSource)}`)
          ws.send(JSON.stringify({ type: 'auth_error', reason: 'invalid session source' } satisfies WsMessage))
          return
        }
        const source = rawSource as SessionSource
        const session = createPtySession(source, clientIP)
        attachedSessionId = session.id
        session.wsClient = ws
        session.clientIP = clientIP
        notifySessions()
        ws.send(
          JSON.stringify({
            type: 'session_attached',
            sessionId: session.id,
            scrollback: '',
            source: session.source,
          } satisfies WsMessage),
        )
        return
      }

      if (msg.type === 'session_attach') {
        const session = ptySessions.get(msg.sessionId)
        if (!session) {
          ws.send(
            JSON.stringify({
              type: 'session_not_found',
              sessionId: msg.sessionId,
            } satisfies WsMessage),
          )
          return
        }
        detachFromSession()
        // 既存のモバイルクライアントを切断（上書きアタッチ）
        if (
          session.wsClient &&
          session.wsClient !== ws &&
          session.wsClient.readyState === WebSocket.OPEN
        ) {
          session.wsClient.close()
        }
        session.wsClient = ws
        session.clientIP = clientIP
        attachedSessionId = session.id
        notifySessions()
        ws.send(
          JSON.stringify({
            type: 'session_attached',
            sessionId: session.id,
            scrollback: getScrollback(session),
            source: session.source,
          } satisfies WsMessage),
        )
        return
      }

      // ── ping/pong ────────────────────────────────────────────────────
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' } satisfies WsMessage))
        return
      }
      if (msg.type === 'pong') {
        pongPending = false
        if (pongTimeoutId) {
          clearTimeout(pongTimeoutId)
          pongTimeoutId = null
        }
        return
      }

      // ── セッション一覧要求（picker・アタッチ済み両方から受け付ける） ────
      if (msg.type === 'session_list_request') {
        const sessions = getSessionInfos()
        const projects = getRecentProjects()
        ws.send(
          JSON.stringify({
            type: 'session_list_response',
            sessions,
            projects,
            multiplexerSessions: [],
          } satisfies WsMessage),
        )
        // マルチプレクサセッションは非同期で取得して追加送信する
        getMultiplexerSessions().then((multiplexerSessions) => {
          if (multiplexerSessions.length > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'session_list_response',
                sessions: getSessionInfos(),
                projects: getRecentProjects(),
                multiplexerSessions,
              } satisfies WsMessage),
            )
          }
        })
        return
      }

      // ── 開発用: 承認プロンプトのモック注入（セッション未アタッチでも動作） ──────
      if ((msg as { type: string }).type === 'debug_trigger_permission' && process.env.NODE_ENV !== 'production') {
        const debugMsg = msg as unknown as { type: string; sessionId?: string }
        const targetId = debugMsg.sessionId ?? attachedSessionId
        const target = targetId ? ptySessions.get(targetId) : null
        if (target?.wsClient?.readyState === WebSocket.OPEN && !target.pendingPermission) {
          sendPermissionRequest(target, 'Bash', ['rm -rf /tmp/test', 'ls -la /Users/user/projects'], true, 'numbered')
          console.log(`[debug] Injected test permission_request to session ${targetId?.slice(0, 8)}`)
        } else {
          console.warn(`[debug] No session with connected mobile client found for debug_trigger_permission`)
        }
        return
      }

      // ── セッション操作フェーズ ────────────────────────────────────────
      if (!attachedSessionId) return
      const session = ptySessions.get(attachedSessionId)
      if (!session) return

      if (msg.type === 'permission_response') {
        const pending = session.pendingPermission
        if (pending && pending.requestId === msg.requestId) {
          clearTimeout(pending.timeoutId)
          session.pendingPermission = null
          session.permissionBuffer = ''
          const keys: Record<typeof pending.style, Record<typeof msg.decision, string>> = {
            numbered: { approve: '1', always: '2', reject: pending.requiresAlways ? '3' : '2' },
            legacy:   { approve: 'y\n', always: 'a\n', reject: 'n\n' },
          }
          sessionWrite(session, keys[pending.style][msg.decision])
        }
        return
      }
      if (msg.type === 'input') {
        sessionWrite(session, msg.data)
        setSessionActive(session)
      }
      if (msg.type === 'resize') {
        sessionResize(session, msg.cols, msg.rows)
      }
    })

    ws.on('close', () => {
      cleanup()

      // 外部プロバイダーが切断された場合はセッションを終了する
      if (isProvider && providerSessionId) {
        const provSession = ptySessions.get(providerSessionId)
        if (provSession) {
          if (provSession.idleTimeoutId) clearTimeout(provSession.idleTimeoutId)
          if (provSession.wsClient?.readyState === WebSocket.OPEN) {
            provSession.wsClient.send(JSON.stringify({ type: 'shell_exit', exitCode: -1 } satisfies WsMessage))
            provSession.wsClient.close()
          }
          serverCallbacks.onPtyExit?.(providerSessionId, -1)
          ptySessions.delete(providerSessionId)
          notifySessions()
        }
        return
      }

      // PTYは維持したままWSクライアントだけデタッチ
      detachFromSession()
    })
  })

  return { wss, getToken: () => AUTH_TOKEN }
}

function resolveShell(): string {
  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
  for (const s of candidates) {
    if (s && existsSync(s)) return s
  }
  return '/bin/sh'
}

// セッション名として許可する文字: 英数字・ドット・アンダースコア・ハイフン
// tmux の "session:window.pane" 構文を避けるためコロンを禁止
const SAFE_SESSION_NAME_RE = /^[a-zA-Z0-9._-]+$/

/**
 * マルチプレクサのセッション名を検証する。
 * 不正な文字が含まれる場合は Error をスローする。
 */
function assertSafeSessionName(name: string, tool: string): void {
  if (!SAFE_SESSION_NAME_RE.test(name)) {
    throw new Error(`[pty-server] Unsafe session name rejected for ${tool}: "${name}"`)
  }
}

function spawnSource(source: SessionSource): pty.IPty {
  const baseOpts = { name: 'xterm-color', cols: 80, rows: 30, env: { ...process.env } }
  switch (source.kind) {
    case 'claude': {
      const loginShell = resolveShell()
      const cwd = source.projectPath && existsSync(source.projectPath) ? source.projectPath : undefined
      console.log(`[pty-server] Spawning claude via shell: ${loginShell}${cwd ? ` (cwd: ${cwd})` : ''}`)
      return pty.spawn(loginShell, ['-lc', 'exec claude'], { ...baseOpts, ...(cwd ? { cwd } : {}) })
    }
    case 'tmux': {
      assertSafeSessionName(source.sessionName, 'tmux')
      console.log(`[pty-server] Attaching to tmux session: ${source.sessionName}`)
      return pty.spawn('tmux', ['attach-session', '-t', source.sessionName], baseOpts)
    }
    case 'screen': {
      assertSafeSessionName(source.sessionName, 'screen')
      console.log(`[pty-server] Attaching to screen session: ${source.sessionName}`)
      return pty.spawn('screen', ['-r', source.sessionName], baseOpts)
    }
    case 'zellij': {
      assertSafeSessionName(source.sessionName, 'zellij')
      console.log(`[pty-server] Attaching to zellij session: ${source.sessionName}`)
      return pty.spawn('zellij', ['attach', source.sessionName], baseOpts)
    }
    case 'shell': {
      const loginShell = resolveShell()
      const cwd = source.cwd && existsSync(source.cwd) ? source.cwd : undefined
      console.log(`[pty-server] Spawning shell: ${loginShell}${cwd ? ` (cwd: ${cwd})` : ''}`)
      return pty.spawn(loginShell, ['-l'], { ...baseOpts, ...(cwd ? { cwd } : {}) })
    }
    default:
      throw new Error(`[pty-server] Unknown session source kind: ${(source as { kind: string }).kind}`)
  }
}

// ─── マルチプレクサセッション一覧取得 ────────────────────────────────────────

/** 利用可能な tmux / screen / zellij セッション一覧を取得する */
export async function getMultiplexerSessions(): Promise<MultiplexerSessionInfo[]> {
  const results: MultiplexerSessionInfo[] = []

  // tmux
  try {
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}:#{session_windows}"')
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const sessionName = line.slice(0, colonIdx)
      const windows = line.slice(colonIdx + 1)
      if (!SAFE_SESSION_NAME_RE.test(sessionName)) continue
      results.push({ tool: 'tmux', sessionName, detail: `${windows} windows` })
    }
  } catch {
    // tmux未インストールまたはセッションなし
  }

  // screen
  try {
    // screen -ls は接続中セッションがある場合に exit code 1 を返すため stdout を取り出す
    const screenOutput = await execAsync('screen -ls').then(
      (r) => r.stdout,
      (e: { stdout?: string }) => e.stdout ?? '',
    )
    for (const line of screenOutput.split('\n')) {
      const match = line.match(/^\s+(\d+\.\S+)\s+.*\((Detached|Attached)\)/)
      if (match) {
        const sessionName = match[1]
        if (!SAFE_SESSION_NAME_RE.test(sessionName)) continue
        results.push({ tool: 'screen', sessionName, detail: match[2] })
      }
    }
  } catch {
    // screen未インストール
  }

  // zellij
  try {
    const { stdout } = await execAsync('zellij list-sessions')
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      // "session-name [Created...]" 形式の場合もあるため最初のトークンだけ取得
      const sessionName = line.trim().split(/\s+/)[0]
      if (sessionName && SAFE_SESSION_NAME_RE.test(sessionName)) {
        results.push({ tool: 'zellij', sessionName })
      }
    }
  } catch {
    // zellij未インストールまたはセッションなし
  }

  return results
}
