import * as pty from 'node-pty'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { existsSync } from 'fs'
import { WsMessage, SessionInfo, DEFAULT_WS_PORT } from '@remocoder/shared'
import { v4 as uuidv4 } from 'uuid'

let AUTH_TOKEN = process.env.REMOTE_TOKEN ?? uuidv4()

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
  pty: pty.IPty
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

function createPtySession(clientIP?: string): PtySession {
  const id = uuidv4()
  const ptyProc = spawnShell()

  const session: PtySession = {
    id,
    pty: ptyProc,
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
    session.pty.write(data)
    setSessionActive(session)
  }
}

/** デスクトップからPTYをリサイズする */
export function desktopResize(sessionId: string, cols: number, rows: number): void {
  ptySessions.get(sessionId)?.pty.resize(cols, rows)
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
          // auth_ok → session_list の順で送信
          ws.send(JSON.stringify({ type: 'auth_ok' } satisfies WsMessage))
          ws.send(
            JSON.stringify({
              type: 'session_list',
              sessions: getSessionInfos(),
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

      // ── セッション選択フェーズ ─────────────────────────────────────────
      if (msg.type === 'session_create') {
        // セッションに接続するので picker から外す
        pickerClients.delete(ws)
        detachFromSession()
        const session = createPtySession(clientIP)
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

      // ── セッション操作フェーズ ────────────────────────────────────────
      if (!attachedSessionId) return
      const session = ptySessions.get(attachedSessionId)
      if (!session) return

      if (msg.type === 'input') {
        session.pty.write(msg.data)
        setSessionActive(session)
      }
      if (msg.type === 'resize') session.pty.resize(msg.cols, msg.rows)
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' } satisfies WsMessage))
      if (msg.type === 'pong') {
        pongPending = false
        if (pongTimeoutId) {
          clearTimeout(pongTimeoutId)
          pongTimeoutId = null
        }
      }
    })

    ws.on('close', () => {
      cleanup()
      pickerClients.delete(ws)
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

function spawnShell(): pty.IPty {
  const loginShell = resolveShell()
  console.log(`Spawning claude via shell: ${loginShell}`)
  return pty.spawn(loginShell, ['-lc', 'exec claude'], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    env: { ...process.env },
  })
}
