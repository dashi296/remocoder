// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mock state ────────────────────────────────────────────────────────
const wsState = vi.hoisted(() => ({ instance: null as any }))
const mockWsSend = vi.hoisted(() => vi.fn())
const mockWsClose = vi.hoisted(() => vi.fn())
const mockPtyShell = vi.hoisted(() => ({ instance: null as any }))
const mockPtySpawn = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())

vi.mock('ws', async () => {
  const { EventEmitter } = await import('events')

  class MockWebSocket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    send = mockWsSend
    close = mockWsClose
    constructor(_url: string) {
      super()
      wsState.instance = this
    }
  }

  return { default: MockWebSocket }
})

vi.mock('node-pty', () => ({
  spawn: mockPtySpawn,
}))

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockShell() {
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
  mockPtyShell.instance = shell
  return shell
}

function sendWsMessage(msg: object) {
  wsState.instance.emit('message', Buffer.from(JSON.stringify(msg)))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CLI index', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...savedEnv }
    process.env.REMOCODER_TOKEN = 'test-token'
    delete process.env.REMOCODER_HOST
    mockWsSend.mockClear()
    mockWsClose.mockClear()
    mockPtySpawn.mockClear()
    mockPtySpawn.mockImplementation(createMockShell)
    wsState.instance = null
    mockPtyShell.instance = null
  })

  afterEach(() => {
    process.env = savedEnv
  })

  // ── 接続・認証 ──────────────────────────────────────────────────────────────

  describe('接続・認証', () => {
    it('open イベントで auth メッセージを送信する', async () => {
      await import('../index')
      wsState.instance.emit('open')
      expect(mockWsSend).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth', token: 'test-token' }),
      )
    })

    it('auth_ok → session_register を送信する', async () => {
      await import('../index')
      wsState.instance.emit('open')
      sendWsMessage({ type: 'auth_ok' })
      expect(mockWsSend).toHaveBeenCalledWith(
        expect.stringContaining('"session_register"'),
      )
    })

    it('session_register に cols / rows を含む', async () => {
      await import('../index')
      wsState.instance.emit('open')
      sendWsMessage({ type: 'auth_ok' })
      const call = mockWsSend.mock.calls.find((c: string[]) =>
        c[0].includes('session_register'),
      )
      const msg = JSON.parse(call![0])
      expect(typeof msg.cols).toBe('number')
      expect(typeof msg.rows).toBe('number')
    })

    it('auth_error → process.exit(1) を呼ぶ', async () => {
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit called')
        }) as any)
      try {
        await import('../index')
        wsState.instance.emit('open')
        expect(() =>
          sendWsMessage({ type: 'auth_error', reason: 'invalid token' }),
        ).toThrow('process.exit called')
        expect(mockExit).toHaveBeenCalledWith(1)
      } finally {
        mockExit.mockRestore()
      }
    })
  })

  // ── セッション登録 ──────────────────────────────────────────────────────────

  describe('session_registered', () => {
    it('claude PTY を起動する', async () => {
      await import('../index')
      wsState.instance.emit('open')
      sendWsMessage({ type: 'auth_ok' })
      sendWsMessage({ type: 'session_registered', sessionId: 'test-session-id-123' })
      expect(mockPtySpawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.objectContaining({ name: 'xterm-color' }),
      )
    })

    it('session_registered が2回来ても PTY を1つしか起動しない', async () => {
      await import('../index')
      wsState.instance.emit('open')
      sendWsMessage({ type: 'auth_ok' })
      sendWsMessage({ type: 'session_registered', sessionId: 'session-1' })
      sendWsMessage({ type: 'session_registered', sessionId: 'session-2' })
      expect(mockPtySpawn).toHaveBeenCalledTimes(1)
    })
  })

  // ── メッセージ処理 ──────────────────────────────────────────────────────────

  describe('メッセージ処理', () => {
    async function setupWithShell() {
      await import('../index')
      wsState.instance.emit('open')
      sendWsMessage({ type: 'auth_ok' })
      sendWsMessage({ type: 'session_registered', sessionId: 'session-abc' })
    }

    it('input → PTY に書き込む', async () => {
      await setupWithShell()
      sendWsMessage({ type: 'input', data: 'hello\n' })
      expect(mockPtyShell.instance.write).toHaveBeenCalledWith('hello\n')
    })

    it('resize → PTY をリサイズする', async () => {
      await setupWithShell()
      sendWsMessage({ type: 'resize', cols: 120, rows: 40 })
      expect(mockPtyShell.instance.resize).toHaveBeenCalledWith(120, 40)
    })

    it('ping → pong を返す', async () => {
      await import('../index')
      wsState.instance.emit('open')
      sendWsMessage({ type: 'auth_ok' })
      mockWsSend.mockClear()
      sendWsMessage({ type: 'ping' })
      expect(mockWsSend).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
    })

    it('不正な JSON は無視する', async () => {
      await import('../index')
      wsState.instance.emit('open')
      expect(() =>
        wsState.instance.emit('message', Buffer.from('not json{')),
      ).not.toThrow()
    })
  })

  // ── PTY 終了 ───────────────────────────────────────────────────────────────

  describe('PTY 終了', () => {
    it('shell_exit を送信して WebSocket を閉じる', async () => {
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)
      try {
        await import('../index')
        wsState.instance.emit('open')
        sendWsMessage({ type: 'auth_ok' })
        sendWsMessage({ type: 'session_registered', sessionId: 'session-abc' })

        mockPtyShell.instance._onExitCb({ exitCode: 0 })

        expect(mockWsSend).toHaveBeenCalledWith(
          JSON.stringify({ type: 'shell_exit', exitCode: 0 }),
        )
        expect(mockWsClose).toHaveBeenCalled()
      } finally {
        mockExit.mockRestore()
      }
    })
  })

  // ── resolveToken ───────────────────────────────────────────────────────────

  describe('resolveToken', () => {
    it('環境変数 REMOCODER_TOKEN が最優先', async () => {
      process.env.REMOCODER_TOKEN = 'env-token'
      await import('../index')
      wsState.instance.emit('open')
      expect(mockWsSend).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth', token: 'env-token' }),
      )
    })

    it('環境変数なし・ファイルあり → ファイルのトークンを使用', async () => {
      delete process.env.REMOCODER_TOKEN
      mockReadFileSync.mockReturnValue(JSON.stringify({ token: 'file-token' }))
      await import('../index')
      wsState.instance.emit('open')
      expect(mockWsSend).toHaveBeenCalledWith(
        JSON.stringify({ type: 'auth', token: 'file-token' }),
      )
    })

    it('環境変数なし・ファイルなし → process.exit(1)', async () => {
      delete process.env.REMOCODER_TOKEN
      mockReadFileSync.mockImplementation(() => {
        throw new Error('no file')
      })
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit called')
        }) as any)
      try {
        await expect(import('../index')).rejects.toThrow('process.exit called')
        expect(mockExit).toHaveBeenCalledWith(1)
      } finally {
        mockExit.mockRestore()
      }
    })

    it('ファイルのトークンが空文字列 → process.exit(1)', async () => {
      delete process.env.REMOCODER_TOKEN
      mockReadFileSync.mockReturnValue(JSON.stringify({ token: '' }))
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit called')
        }) as any)
      try {
        await expect(import('../index')).rejects.toThrow('process.exit called')
        expect(mockExit).toHaveBeenCalledWith(1)
      } finally {
        mockExit.mockRestore()
      }
    })
  })

  // ── WebSocket エラー ────────────────────────────────────────────────────────

  describe('WebSocket エラー', () => {
    it('error イベント → process.exit(1)', async () => {
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit called')
        }) as any)
      try {
        await import('../index')
        expect(() =>
          wsState.instance.emit('error', new Error('connection refused')),
        ).toThrow('process.exit called')
        expect(mockExit).toHaveBeenCalledWith(1)
      } finally {
        mockExit.mockRestore()
      }
    })
  })
})
