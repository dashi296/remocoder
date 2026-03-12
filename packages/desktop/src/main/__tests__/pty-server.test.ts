// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Hoisted shared state accessible in both mock factories and tests
const wssState = vi.hoisted(() => ({ instance: null as (EventEmitter & { close: ReturnType<typeof vi.fn> }) | null }))
const ptyState = vi.hoisted(() => ({ lastShell: null as any }))
const mockUuidv4 = vi.hoisted(() => vi.fn().mockReturnValue('test-token'))

vi.mock('uuid', () => ({ v4: mockUuidv4 }))

vi.mock('ws', async () => {
  const { EventEmitter } = await import('events')

  class MockWSS extends EventEmitter {
    close = vi.fn()
    constructor(_opts: any) {
      super()
      wssState.instance = this as any
    }
  }

  return { WebSocketServer: MockWSS, WebSocket: { OPEN: 1 } }
})

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const shell: any = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      _onDataCb: null as ((data: string) => void) | null,
      _onExitCb: null as ((e: { exitCode: number }) => void) | null,
      onData(cb: (data: string) => void) {
        this._onDataCb = cb
      },
      onExit(cb: (e: { exitCode: number }) => void) {
        this._onExitCb = cb
      },
    }
    ptyState.lastShell = shell
    return shell
  }),
}))

// Helper: create a mock WebSocket that supports EventEmitter + send/close
function createMockWs() {
  const ws: any = new EventEmitter()
  ws.send = vi.fn()
  ws.close = vi.fn()
  ws.readyState = 1
  ws.OPEN = 1
  return ws
}

// Helper: simulate a message arriving from the client
function sendMessage(ws: any, msg: object) {
  ws.emit('message', Buffer.from(JSON.stringify(msg)))
}

// Helper: connect + auth + get session list
function connectAndAuth(startPtyServer: any) {
  startPtyServer()
  const ws = createMockWs()
  wssState.instance!.emit('connection', ws)
  sendMessage(ws, { type: 'auth', token: 'test-token' })
  ws.send.mockClear()
  return { ws }
}

// Helper: connect + auth + create session (full flow)
function connectAuthAndCreate(startPtyServer: any) {
  const { ws } = connectAndAuth(startPtyServer)
  sendMessage(ws, { type: 'session_create' })
  ws.send.mockClear()
  return { ws }
}

describe('startPtyServer', () => {
  let startPtyServer: (port?: number, callbacks?: any) => { wss: any; getToken: () => string }

  beforeEach(async () => {
    vi.resetModules()
    delete process.env.REMOTE_TOKEN
    mockUuidv4.mockReturnValue('test-token')
    wssState.instance = null
    ptyState.lastShell = null
    const mod = await import('../pty-server')
    startPtyServer = mod.startPtyServer
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('指定ポートで WS サーバーが起動する', () => {
    startPtyServer(9999)
    expect(wssState.instance).not.toBeNull()
  })

  it('uuidv4 をトークンとして返す', () => {
    const { getToken } = startPtyServer()
    expect(getToken()).toBe('test-token')
  })

  it('REMOTE_TOKEN が設定されていればそれをトークンとして使う', async () => {
    process.env.REMOTE_TOKEN = 'env-token'
    vi.resetModules()
    const { startPtyServer: sp } = await import('../pty-server')
    const { getToken } = sp()
    expect(getToken()).toBe('env-token')
  })

  describe('認証', () => {
    it('正しいトークンで auth_ok + session_list を送信する', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth_ok' }))
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'session_list', sessions: [] }),
      )
    })

    it('auth_ok 後は PTY を即座にスポーンしない', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })

      expect(ptyState.lastShell).toBeNull()
    })

    it('不正なトークンで auth_error を送信し ws.close() を呼ぶ', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'wrong-token' })

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth_error', reason: 'invalid token' }),
      )
      expect(ws.close).toHaveBeenCalled()
    })

    it('5秒以内に auth がない場合 ws.close() を呼ぶ', () => {
      vi.useFakeTimers()
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)

      expect(ws.close).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5000)
      expect(ws.close).toHaveBeenCalled()
    })
  })

  describe('session_create', () => {
    it('session_create で PTY をスポーンし session_attached を返す', () => {
      const { ws } = connectAndAuth(startPtyServer)
      sendMessage(ws, { type: 'session_create' })

      expect(ptyState.lastShell).not.toBeNull()
      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const attached = calls.find((m: any) => m.type === 'session_attached')
      expect(attached).toBeDefined()
      expect(attached.scrollback).toBe('')
    })
  })

  describe('session_attach', () => {
    it('存在しない sessionId で session_not_found を返す', () => {
      const { ws } = connectAndAuth(startPtyServer)
      sendMessage(ws, { type: 'session_attach', sessionId: 'nonexistent' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const notFound = calls.find((m: any) => m.type === 'session_not_found')
      expect(notFound).toBeDefined()
    })
  })

  describe('セッション操作（session_create 後）', () => {
    it('input メッセージが shell.write() を呼ぶ', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      sendMessage(ws, { type: 'input', data: 'hello\n' })
      expect(ptyState.lastShell.write).toHaveBeenCalledWith('hello\n')
    })

    it('resize メッセージが shell.resize() を呼ぶ', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      sendMessage(ws, { type: 'resize', cols: 120, rows: 40 })
      expect(ptyState.lastShell.resize).toHaveBeenCalledWith(120, 40)
    })

    it('ping メッセージに pong を返す', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      sendMessage(ws, { type: 'ping' })
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
    })

    it('pong メッセージを受信してもエラーにならない', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      expect(() => sendMessage(ws, { type: 'pong' })).not.toThrow()
    })

    it('不正な JSON メッセージを受信してもエラーにならない', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      expect(() => ws.emit('message', Buffer.from('not-valid-json'))).not.toThrow()
    })
  })

  describe('PTY イベント', () => {
    it('shell の onData → output メッセージを送信する (ws.OPEN 時)', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      ptyState.lastShell._onDataCb('some output')
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'output', data: 'some output' }))
    })

    it('ws が閉じている場合 shell の onData でメッセージを送信しない', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      ws.readyState = 0 // not OPEN
      ptyState.lastShell._onDataCb('some output')
      expect(ws.send).not.toHaveBeenCalled()
    })

    it('shell の onExit → shell_exit メッセージ送信 + ws.close() を呼ぶ', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      ptyState.lastShell._onExitCb({ exitCode: 0 })
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'shell_exit', exitCode: 0 }),
      )
      expect(ws.close).toHaveBeenCalled()
    })

    it('onPtyOutput コールバックが PTY 出力時に呼ばれる', () => {
      const onPtyOutput = vi.fn()
      const mod = { startPtyServer }
      mod.startPtyServer(undefined, { onPtyOutput })
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      sendMessage(ws, { type: 'session_create' })

      ptyState.lastShell._onDataCb('hello')
      expect(onPtyOutput).toHaveBeenCalledWith(expect.any(String), 'hello')
    })
  })

  describe('ws close', () => {
    it('クライアント切断後もセッション（PTY）は維持される', () => {
      const onSessionsChange = vi.fn()
      startPtyServer(undefined, { onSessionsChange })
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      sendMessage(ws, { type: 'session_create' })

      const beforeClose = onSessionsChange.mock.calls.at(-1)[0]
      expect(beforeClose.length).toBe(1)

      ws.emit('close')

      // セッションは残るがkillされない
      expect(ptyState.lastShell.kill).not.toHaveBeenCalled()
      // onSessionsChange が呼ばれてもセッション自体は残っている
    })

    it('認証前に切断されても authTimeout がクリアされタイムアウト後に close を呼ばない', () => {
      vi.useFakeTimers()
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      ws.emit('close')
      vi.advanceTimersByTime(5000)
      expect(ws.close).not.toHaveBeenCalled()
    })
  })
})
