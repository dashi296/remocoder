import * as pty from 'node-pty'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { WsMessage, SessionInfo, DEFAULT_WS_PORT } from '@remocoder/shared'
import { v4 as uuidv4 } from 'uuid'

const AUTH_TOKEN = process.env.REMOTE_TOKEN ?? uuidv4()

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

    const authTimeout = setTimeout(() => {
      if (!authenticated) ws.close()
    }, 5000)

    ws.on('message', (raw) => {
      const msg: WsMessage = JSON.parse(raw.toString())

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

          ws.send(JSON.stringify({ type: 'auth_ok' }))
        } else {
          ws.send(JSON.stringify({ type: 'auth_error', reason: 'invalid token' }))
          ws.close()
        }
        return
      }

      if (!shell) return

      if (msg.type === 'input') shell.write(msg.data)
      if (msg.type === 'resize') shell.resize(msg.cols, msg.rows)
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
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
      const msg: WsMessage = {
        type: 'output',
        data: `\r\n[claudeが終了しました (exit code: ${exitCode})]`,
      }
      ws.send(JSON.stringify(msg))
      ws.close()
    }
  })

  return shell
}
