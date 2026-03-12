import * as pty from 'node-pty'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { WsMessage, SessionInfo, ProjectInfo, DEFAULT_WS_PORT } from '@remocoder/shared'
import { v4 as uuidv4 } from 'uuid'

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

/** ~/.claude/projects/ から最近使ったプロジェクト一覧を取得する */
export function getRecentProjects(limit = 20): ProjectInfo[] {
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

    return projects
      .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
      .slice(0, limit)
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

/** サーバー内部で管理するPTYセッション */
interface PtySession {
  id: string
  /** ローカルPTYプロセス（外部セッションの場合は null） */
  pty: pty.IPty | null
  /** 外部ターミナルからのWSプロバイダー接続（外部セッションの場合のみ設定） */
  providerWs: WebSocket | null
  createdAt: string
  status: 'active' | 'idle'
  /** PTY出力履歴（最大SCROLLBACK_MAX_BYTES） */
  scrollback: string
  /** 接続中のモバイルWSクライアント（1台のみ） */
  wsClient: WebSocket | null
  clientIP?: string
  idleTimeoutId: ReturnType<typeof setTimeout> | null
}

/** 永続PTYセッションマップ（WS切断後も保持） */
const ptySessions = new Map<string, PtySession>()

/**
 * 認証済みでまだセッションを選択していないWSクライアント（セッション選択画面）。
 * セッション一覧が変化したときにリアルタイムで session_list をプッシュするために使用する。
 */
const pickerClients = new Set<WebSocket>()

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

  // セッション選択中のモバイルクライアントへ最新一覧をプッシュ
  if (pickerClients.size > 0) {
    const msg = JSON.stringify({ type: 'session_list', sessions: infos } satisfies WsMessage)
    for (const client of pickerClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
  }
}

function getSessionInfos(): SessionInfo[] {
  return Array.from(ptySessions.values()).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    status: s.status,
    clientIP: s.clientIP,
    hasClient: s.wsClient !== null && s.wsClient.readyState === WebSocket.OPEN,
    isExternal: s.pty === null,
  }))
}

function setSessionActive(session: PtySession) {
  if (session.status !== 'active') {
    session.status = 'active'
    notifySessions()
  }
  if (session.idleTimeoutId) clearTimeout(session.idleTimeoutId)
  session.idleTimeoutId = setTimeout(() => {
    const s = ptySessions.get(session.id)
    if (s) {
      s.status = 'idle'
      notifySessions()
    }
  }, IDLE_TIMEOUT)
}

function createPtySession(clientIP?: string, projectPath?: string): PtySession {
  const id = uuidv4()
  const ptyProc = spawnShell(projectPath)

  const session: PtySession = {
    id,
    pty: ptyProc,
    providerWs: null,
    createdAt: new Date().toISOString(),
    status: 'active',
    scrollback: '',
    wsClient: null,
    clientIP,
    idleTimeoutId: null,
  }

  ptyProc.onData((data) => {
    // スクロールバックに追記（最大バイト数を超えたら先頭を切り捨て）
    session.scrollback += data
    if (session.scrollback.length > SCROLLBACK_MAX_BYTES) {
      session.scrollback = session.scrollback.slice(
        session.scrollback.length - SCROLLBACK_MAX_BYTES,
      )
    }
    // モバイルWSクライアントへブロードキャスト
    if (session.wsClient?.readyState === WebSocket.OPEN) {
      session.wsClient.send(JSON.stringify({ type: 'output', data } satisfies WsMessage))
    }
    // デスクトップRendererへIPC経由でブロードキャスト
    serverCallbacks.onPtyOutput?.(id, data)
  })

  ptyProc.onExit(({ exitCode }) => {
    if (session.idleTimeoutId) clearTimeout(session.idleTimeoutId)
    // モバイルクライアントへ終了通知
    if (session.wsClient?.readyState === WebSocket.OPEN) {
      session.wsClient.send(JSON.stringify({ type: 'shell_exit', exitCode } satisfies WsMessage))
      session.wsClient.close()
    }
    // デスクトップRendererへ終了通知
    serverCallbacks.onPtyExit?.(id, exitCode)
    // セッション削除
    console.log(`[pty-server] Session ${id.slice(0, 8)} exited (code: ${exitCode}). Remaining: ${ptySessions.size - 1}`)
    ptySessions.delete(id)
    notifySessions()
  })

  ptySessions.set(id, session)

  // アイドルタイマー開始
  session.idleTimeoutId = setTimeout(() => {
    const s = ptySessions.get(id)
    if (s) {
      s.status = 'idle'
      notifySessions()
    }
  }, IDLE_TIMEOUT)

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
    scrollback: '',
    wsClient: null,
    idleTimeoutId: null,
  }

  ptySessions.set(id, session)

  // アイドルタイマー開始
  session.idleTimeoutId = setTimeout(() => {
    const s = ptySessions.get(id)
    if (s) {
      s.status = 'idle'
      notifySessions()
    }
  }, IDLE_TIMEOUT)

  notifySessions()
  console.log(`[pty-server] Created external session: ${id}`)
  return session
}

// ─── デスクトップRenderer向けパブリックAPI ─────────────────────────────────────

/** デスクトップから新規PTYセッションを作成する */
export function desktopCreateSession(): string {
  const session = createPtySession()
  return session.id
}

/** デスクトップからセッションのスクロールバックを取得する */
export function desktopGetScrollback(sessionId: string): string | null {
  return ptySessions.get(sessionId)?.scrollback ?? null
}

/** デスクトップからPTYへ入力を送る */
export function desktopSendInput(sessionId: string, data: string): void {
  const session = ptySessions.get(sessionId)
  if (session) {
    if (session.pty) {
      session.pty.write(data)
    } else if (session.providerWs?.readyState === WebSocket.OPEN) {
      session.providerWs.send(JSON.stringify({ type: 'input', data } satisfies WsMessage))
    }
    setSessionActive(session)
  }
}

/** デスクトップからPTYをリサイズする */
export function desktopResize(sessionId: string, cols: number, rows: number): void {
  const session = ptySessions.get(sessionId)
  if (!session) return
  if (session.pty) {
    session.pty.resize(cols, rows)
  } else if (session.providerWs?.readyState === WebSocket.OPEN) {
    session.providerWs.send(JSON.stringify({ type: 'resize', cols, rows } satisfies WsMessage))
  }
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
          // picker クライアントとして登録（session_create/attach が来るまで保持）
          pickerClients.add(ws)
          const sessionInfos = getSessionInfos()
          const projects = getRecentProjects()
          console.log(`[pty-server] Auth OK from ${clientIP ?? 'unknown'}. Sessions: ${ptySessions.size}, Projects: ${projects.length}`)
          // auth_ok → project_list の順で送信
          ws.send(JSON.stringify({ type: 'auth_ok' } satisfies WsMessage))
          ws.send(JSON.stringify({ type: 'project_list', projects } satisfies WsMessage))
          // pickerClients はデスクトップ内部用（モバイルは project_list を使う）
          // session_list は後方互換のため残すが、モバイルは使用しない
          ws.send(
            JSON.stringify({
              type: 'session_list',
              sessions: sessionInfos,
            } satisfies WsMessage),
          )
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
        pickerClients.delete(ws)
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
          // スクロールバックに追記
          provSession.scrollback += msg.data
          if (provSession.scrollback.length > SCROLLBACK_MAX_BYTES) {
            provSession.scrollback = provSession.scrollback.slice(
              provSession.scrollback.length - SCROLLBACK_MAX_BYTES,
            )
          }
          // モバイルWSクライアントへ転送
          if (provSession.wsClient?.readyState === WebSocket.OPEN) {
            provSession.wsClient.send(JSON.stringify({ type: 'output', data: msg.data } satisfies WsMessage))
          }
          // デスクトップRendererへ通知
          serverCallbacks.onPtyOutput?.(providerSessionId, msg.data)
          setSessionActive(provSession)
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
        } else if (msg.type === 'resize') {
          // プロバイダー側でのリサイズ通知（モバイルUIへの通知は不要）
        }
        return
      }

      // ── セッション選択フェーズ ─────────────────────────────────────────
      if (msg.type === 'session_create') {
        // セッションに接続するので picker から外す
        pickerClients.delete(ws)
        detachFromSession()
        const session = createPtySession(clientIP, msg.projectPath)
        attachedSessionId = session.id
        session.wsClient = ws
        session.clientIP = clientIP
        notifySessions()
        ws.send(
          JSON.stringify({
            type: 'session_attached',
            sessionId: session.id,
            scrollback: '',
          } satisfies WsMessage),
        )
        return
      }

      if (msg.type === 'session_attach') {
        // セッションに接続するので picker から外す
        pickerClients.delete(ws)
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
            scrollback: session.scrollback,
          } satisfies WsMessage),
        )
        return
      }

      // ── ping/pong はセッション未選択中（picker）でも処理する ────────────
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

      // ── セッション操作フェーズ ────────────────────────────────────────
      if (!attachedSessionId) return
      const session = ptySessions.get(attachedSessionId)
      if (!session) return

      if (msg.type === 'input') {
        if (session.pty) {
          session.pty.write(msg.data)
        } else if (session.providerWs?.readyState === WebSocket.OPEN) {
          session.providerWs.send(JSON.stringify({ type: 'input', data: msg.data } satisfies WsMessage))
        }
        setSessionActive(session)
      }
      if (msg.type === 'resize') {
        if (session.pty) {
          session.pty.resize(msg.cols, msg.rows)
        } else if (session.providerWs?.readyState === WebSocket.OPEN) {
          session.providerWs.send(JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows } satisfies WsMessage))
        }
      }
    })

    ws.on('close', () => {
      cleanup()
      pickerClients.delete(ws)

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

function spawnShell(projectPath?: string): pty.IPty {
  const loginShell = resolveShell()
  const cwd = projectPath && existsSync(projectPath) ? projectPath : undefined
  console.log(`Spawning claude via shell: ${loginShell}${cwd ? ` (cwd: ${cwd})` : ''}`)
  return pty.spawn(loginShell, ['-lc', 'exec claude'], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    env: { ...process.env },
    ...(cwd ? { cwd } : {}),
  })
}
