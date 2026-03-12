import * as pty from 'node-pty'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { WsMessage, SessionInfo, DEFAULT_WS_PORT } from '@remocoder/shared'
import { v4 as uuidv4 } from 'uuid'

const AUTH_TOKEN = process.env.REMOTE_TOKEN ?? uuidv4()

// サーバーからクライアントへのping間隔（ms）
const SERVER_PING_INTERVAL = 30000
// pong未応答タイムアウト（ms）: ping送信後この時間内にpongがなければ切断
const PONG_TIMEOUT = 10000
// アイドル判定時間（ms）: 最後の入力からこの時間経過でidleに変更
const IDLE_TIMEOUT = 300000

export function startPtyServer(
  port = DEFAULT_WS_PORT,
  onSessionsChange?: (sessions: SessionInfo[]) => void,
) {
  const wss = new WebSocketServer({ port })
  const sessions = new Map<string, SessionInfo>()

  const notify = () => {
    onSessionsChange?.(Array.from(sessions.values()))
  }

  console.log(`PTY server started on port ${port}`)
  console.log(`Auth token: ${AUTH_TOKEN}`)

  wss.on('connection', (ws, req: IncomingMessage) => {
    let authenticated = false
    let shell: pty.IPty | null = null
    let sessionId: string | null = null
    let pongPending = false
    let pingIntervalId: ReturnType<typeof setInterval> | null = null
    let pongTimeoutId: ReturnType<typeof setTimeout> | null = null
    let idleTimeoutId: ReturnType<typeof setTimeout> | null = null

    const authTimeout = setTimeout(() => {
      if (!authenticated) ws.close()
    }, 5000)

    const setActive = () => {
      if (!sessionId) return
      const session = sessions.get(sessionId)
      if (session && session.status !== 'active') {
        sessions.set(sessionId, { ...session, status: 'active' })
        notify()
      }
      if (idleTimeoutId) clearTimeout(idleTimeoutId)
      idleTimeoutId = setTimeout(() => {
        if (!sessionId) return
        const s = sessions.get(sessionId)
        if (s) {
          sessions.set(sessionId, { ...s, status: 'idle' })
          notify()
        }
      }, IDLE_TIMEOUT)
    }

    const startPingInterval = () => {
      pingIntervalId = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return
        pongPending = true
        ws.send(JSON.stringify({ type: 'ping' }))
        pongTimeoutId = setTimeout(() => {
          if (pongPending) {
            console.log(`Session ${sessionId}: pong timeout, closing connection`)
            ws.close()
          }
        }, PONG_TIMEOUT)
      }, SERVER_PING_INTERVAL)
    }

    const cleanup = () => {
      clearTimeout(authTimeout)
      if (pingIntervalId) clearInterval(pingIntervalId)
      if (pongTimeoutId) clearTimeout(pongTimeoutId)
      if (idleTimeoutId) clearTimeout(idleTimeoutId)
    }

    ws.on('message', (raw) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        console.warn('Received malformed message, ignoring')
        return
      }

      if (!authenticated) {
        if (msg.type === 'auth' && msg.token === AUTH_TOKEN) {
          authenticated = true
          clearTimeout(authTimeout)
          shell = spawnClaude(ws)

          sessionId = uuidv4()
          sessions.set(sessionId, {
            id: sessionId,
            createdAt: new Date().toISOString(),
            status: 'active',
            clientIP: req?.socket?.remoteAddress,
          })
          notify()
          startPingInterval()
          idleTimeoutId = setTimeout(() => {
            if (!sessionId) return
            const s = sessions.get(sessionId)
            if (s) {
              sessions.set(sessionId, { ...s, status: 'idle' })
              notify()
            }
          }, IDLE_TIMEOUT)

          ws.send(JSON.stringify({ type: 'auth_ok' }))
        } else {
          ws.send(JSON.stringify({ type: 'auth_error', reason: 'invalid token' }))
          ws.close()
        }
        return
      }

      if (!shell) return

      if (msg.type === 'input') {
        shell.write(msg.data)
        setActive()
      }
      if (msg.type === 'resize') shell.resize(msg.cols, msg.rows)
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
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
      shell?.kill()
      if (sessionId) {
        sessions.delete(sessionId)
        notify()
      }
    })
  })

  return { wss, token: AUTH_TOKEN }
}

function spawnClaude(ws: WebSocket): pty.IPty {
  const shell = pty.spawn('claude', [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    env: { ...process.env },
  })

  shell.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      const msg: WsMessage = { type: 'output', data }
      ws.send(JSON.stringify(msg))
    }
  })

  shell.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'shell_exit', exitCode } satisfies WsMessage))
      ws.close()
    }
  })

  return shell
}
