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

describe('startPtyServer', () => {
  let startPtyServer: (port?: number) => { wss: any; token: string }

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
    it('正しいトークンで auth_ok を送信し PTY をスポーンする', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth_ok' }))
      expect(ptyState.lastShell).not.toBeNull()
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

  describe('認証後のメッセージ', () => {
    function connectAndAuth() {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      ws.send.mockClear()
      return { ws }
    }

    it('input メッセージが shell.write() を呼ぶ', () => {
      const { ws } = connectAndAuth()
      sendMessage(ws, { type: 'input', data: 'hello\n' })
      expect(ptyState.lastShell.write).toHaveBeenCalledWith('hello\n')
    })

    it('resize メッセージが shell.resize() を呼ぶ', () => {
      const { ws } = connectAndAuth()
      sendMessage(ws, { type: 'resize', cols: 120, rows: 40 })
      expect(ptyState.lastShell.resize).toHaveBeenCalledWith(120, 40)
    })

    it('ping メッセージに pong を返す', () => {
      const { ws } = connectAndAuth()
      sendMessage(ws, { type: 'ping' })
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
    })

    it('pong メッセージを受信してもエラーにならない', () => {
      const { ws } = connectAndAuth()
      expect(() => sendMessage(ws, { type: 'pong' })).not.toThrow()
    })

    it('不正な JSON メッセージを受信してもエラーにならない', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      ws.send.mockClear()
      expect(() => ws.emit('message', Buffer.from('not-valid-json'))).not.toThrow()
    })
  })

  describe('PTY イベント', () => {
    function connectAndAuth() {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      ws.send.mockClear()
      return { ws }
    }

    it('shell の onData → output メッセージを送信する (ws.OPEN 時)', () => {
      const { ws } = connectAndAuth()
      ptyState.lastShell._onDataCb('some output')
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'output', data: 'some output' }))
    })

    it('ws が閉じている場合 shell の onData でメッセージを送信しない', () => {
      const { ws } = connectAndAuth()
      ws.readyState = 0 // not OPEN
      ptyState.lastShell._onDataCb('some output')
      expect(ws.send).not.toHaveBeenCalled()
    })

    it('shell の onExit → shell_exit メッセージ送信 + ws.close() を呼ぶ', () => {
      const { ws } = connectAndAuth()
      ptyState.lastShell._onExitCb({ exitCode: 0 })
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'shell_exit', exitCode: 0 }),
      )
      expect(ws.close).toHaveBeenCalled()
    })
  })

  describe('ws close', () => {
    it('クライアント切断時に shell.kill() を呼ぶ', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      ws.emit('close')
      expect(ptyState.lastShell.kill).toHaveBeenCalled()
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
