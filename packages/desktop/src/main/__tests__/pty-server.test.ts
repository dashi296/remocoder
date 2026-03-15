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

// CcSession は child_process.spawn を呼ぶためモック化する
vi.mock('../cc-session', () => ({
  CcSession: vi.fn().mockImplementation(() => ({
    setClient: vi.fn(),
    kill: vi.fn(),
    sendUserMessage: vi.fn(),
    handlePermissionResponse: vi.fn(),
  })),
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

// Helper: connect + auth + create PTY session (shell source) for PTY-specific tests
function connectAuthAndCreate(startPtyServer: any) {
  const { ws } = connectAndAuth(startPtyServer)
  sendMessage(ws, { type: 'session_create', source: { kind: 'shell' } })
  ws.send.mockClear()
  return { ws }
}

describe('startPtyServer', () => {
  let startPtyServer: (port?: number, callbacks?: any) => { wss: any; getToken: () => string }
  let desktopCreateSession: () => string

  beforeEach(async () => {
    vi.resetModules()
    delete process.env.REMOTE_TOKEN
    mockUuidv4.mockReturnValue('test-token')
    wssState.instance = null
    ptyState.lastShell = null
    const mod = await import('../pty-server')
    startPtyServer = mod.startPtyServer
    desktopCreateSession = mod.desktopCreateSession
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
    it('正しいトークンで auth_ok + project_list + session_list を送信する', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      expect(calls.some((m: any) => m.type === 'auth_ok')).toBe(true)
      expect(calls.some((m: any) => m.type === 'project_list')).toBe(true)
      expect(calls.some((m: any) => m.type === 'session_list')).toBe(true)
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

  it('desktopCreateSession で作成したセッションが WS 接続時の session_list に含まれる', () => {
    startPtyServer()
    desktopCreateSession()

    const ws = createMockWs()
    wssState.instance!.emit('connection', ws)
    sendMessage(ws, { type: 'auth', token: 'test-token' })

    const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
    const sessionListMsg = calls.find((m: any) => m.type === 'session_list')
    expect(sessionListMsg).toBeDefined()
    expect(sessionListMsg.sessions.length).toBe(1)
  })

  describe('picker クライアント（セッション未選択）の ping/pong', () => {
    it('認証後セッション未選択の状態で pong を受信しても接続が維持される', () => {
      vi.useFakeTimers()
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      ws.send.mockClear()

      // サーバーが ping を送信する（30秒後）
      vi.advanceTimersByTime(30000)
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))

      // クライアントが pong を返す
      sendMessage(ws, { type: 'pong' })

      // pong タイムアウト（10秒後）を経過させても ws は閉じない
      vi.advanceTimersByTime(10000)
      expect(ws.close).not.toHaveBeenCalled()
    })

    it('認証後セッション未選択の状態でクライアントの ping に pong を返す', () => {
      const { ws } = connectAndAuth(startPtyServer)
      sendMessage(ws, { type: 'ping' })
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }))
    })
  })

  describe('session_create', () => {
    it('session_create (shell) で PTY をスポーンし session_attached を返す', () => {
      const { ws } = connectAndAuth(startPtyServer)
      sendMessage(ws, { type: 'session_create', source: { kind: 'shell' } })

      expect(ptyState.lastShell).not.toBeNull()
      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const attached = calls.find((m: any) => m.type === 'session_attached')
      expect(attached).toBeDefined()
      expect(attached.scrollback).toBe('')
    })

    it('session_create (claude) で CcSession を作成し session_attached を返す', () => {
      const { ws } = connectAndAuth(startPtyServer)
      sendMessage(ws, { type: 'session_create' })

      // CcSession が使われるため PTY は spawn されない
      expect(ptyState.lastShell).toBeNull()
      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const attached = calls.find((m: any) => m.type === 'session_attached')
      expect(attached).toBeDefined()
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

    it('既存クライアントがいる場合、上書きアタッチで旧クライアントを強制切断する', () => {
      startPtyServer()

      // セッションを作成してアタッチ（shell で PTY を使用）
      const firstWs = createMockWs()
      wssState.instance!.emit('connection', firstWs)
      sendMessage(firstWs, { type: 'auth', token: 'test-token' })
      sendMessage(firstWs, { type: 'session_create', source: { kind: 'shell' } })
      const sessionId = JSON.parse(
        firstWs.send.mock.calls.find((c: any) => JSON.parse(c[0]).type === 'session_attached')[0],
      ).sessionId

      // 別クライアントが同じセッションにアタッチ
      const secondWs = createMockWs()
      wssState.instance!.emit('connection', secondWs)
      sendMessage(secondWs, { type: 'auth', token: 'test-token' })
      sendMessage(secondWs, { type: 'session_attach', sessionId })

      // 旧クライアントが強制切断される
      expect(firstWs.close).toHaveBeenCalled()

      // 新クライアントに session_attached が返る
      const calls = secondWs.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      expect(calls.find((m: any) => m.type === 'session_attached')).toBeDefined()
    })

    it('session_attach 成功後に scrollback が含まれる session_attached を返す', () => {
      startPtyServer()

      // PTY セッション作成 + PTY 出力を積む
      const ws1 = createMockWs()
      wssState.instance!.emit('connection', ws1)
      sendMessage(ws1, { type: 'auth', token: 'test-token' })
      sendMessage(ws1, { type: 'session_create', source: { kind: 'shell' } })
      const sessionId = JSON.parse(
        ws1.send.mock.calls.find((c: any) => JSON.parse(c[0]).type === 'session_attached')[0],
      ).sessionId
      ptyState.lastShell._onDataCb('past output')
      ws1.emit('close')

      // 新クライアントがアタッチ → scrollback が届く
      const ws2 = createMockWs()
      wssState.instance!.emit('connection', ws2)
      sendMessage(ws2, { type: 'auth', token: 'test-token' })
      sendMessage(ws2, { type: 'session_attach', sessionId })

      const calls = ws2.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const attached = calls.find((m: any) => m.type === 'session_attached')
      expect(attached?.scrollback).toBe('past output')
    })
  })

  describe('session_list_request', () => {
    it('アタッチ済みクライアントが session_list_request を送ると session_list_response が返る', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      sendMessage(ws, { type: 'session_list_request' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'session_list_response')
      expect(response).toBeDefined()
      expect(Array.isArray(response.sessions)).toBe(true)
      expect(Array.isArray(response.projects)).toBe(true)
    })

    it('picker クライアント（未アタッチ）も session_list_request を送ると session_list_response が返る', () => {
      const { ws } = connectAndAuth(startPtyServer)
      sendMessage(ws, { type: 'session_list_request' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'session_list_response')
      expect(response).toBeDefined()
    })

    it('session_list_response の sessions に現在のセッションが含まれる', () => {
      startPtyServer()

      // 各 session_create で別の ID を返すよう mockReturnValueOnce で設定
      mockUuidv4.mockReturnValueOnce('session-id-1').mockReturnValueOnce('session-id-2')

      const ws1 = createMockWs()
      wssState.instance!.emit('connection', ws1)
      sendMessage(ws1, { type: 'auth', token: 'test-token' })
      sendMessage(ws1, { type: 'session_create' }) // uuidv4() → 'session-id-1'

      const ws2 = createMockWs()
      wssState.instance!.emit('connection', ws2)
      sendMessage(ws2, { type: 'auth', token: 'test-token' })
      sendMessage(ws2, { type: 'session_create' }) // uuidv4() → 'session-id-2'
      ws2.send.mockClear()

      sendMessage(ws2, { type: 'session_list_request' })
      const calls = ws2.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'session_list_response')
      expect(response.sessions.length).toBe(2)
    })
  })

  describe('session_create の projectPath 保持', () => {
    it('session_create に projectPath を渡すと SessionInfo に反映される', () => {
      const onSessionsChange = vi.fn()
      startPtyServer(undefined, { onSessionsChange })
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      sendMessage(ws, { type: 'session_create', projectPath: '/home/user/myproject' })

      const lastSessions: any[] = onSessionsChange.mock.calls.at(-1)![0]
      expect(lastSessions[0].projectPath).toBe('/home/user/myproject')
    })

    it('session_list_response の sessions[].projectPath が含まれる', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      sendMessage(ws, { type: 'session_create', projectPath: '/home/user/proj' })
      ws.send.mockClear()

      sendMessage(ws, { type: 'session_list_request' })
      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'session_list_response')
      expect(response.sessions[0].projectPath).toBe('/home/user/proj')
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
      startPtyServer(undefined, { onPtyOutput })
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      sendMessage(ws, { type: 'session_create', source: { kind: 'shell' } })

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
      sendMessage(ws, { type: 'session_create', source: { kind: 'shell' } })

      const beforeClose = onSessionsChange.mock.calls.at(-1)![0]
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

  describe('外部ターミナルセッション（session_register）', () => {
    // プロバイダー接続のヘルパー
    function connectAndRegister(startPtyServer: any) {
      startPtyServer()
      const providerWs = createMockWs()
      wssState.instance!.emit('connection', providerWs)
      sendMessage(providerWs, { type: 'auth', token: 'test-token' })
      providerWs.send.mockClear()
      sendMessage(providerWs, { type: 'session_register', cols: 80, rows: 30 })
      const calls = providerWs.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const registered = calls.find((m: any) => m.type === 'session_registered')
      providerWs.send.mockClear()
      return { providerWs, sessionId: registered?.sessionId }
    }

    it('session_register で session_registered が返りセッション一覧に追加される', () => {
      const { providerWs, sessionId } = connectAndRegister(startPtyServer)

      expect(sessionId).toBeDefined()

      // 別クライアントが認証すると session_list に外部セッションが含まれる
      const pickerWs = createMockWs()
      wssState.instance!.emit('connection', pickerWs)
      sendMessage(pickerWs, { type: 'auth', token: 'test-token' })

      const calls = pickerWs.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const sessionList = calls.find((m: any) => m.type === 'session_list')
      expect(sessionList?.sessions.length).toBe(1)
      expect(sessionList?.sessions[0].isExternal).toBe(true)
      expect(providerWs.send).not.toHaveBeenCalledWith(
        expect.stringContaining('"type":"session_list"'),
      )
    })

    it('プロバイダーの output → アタッチ中のモバイルクライアントへ転送される', () => {
      const { providerWs, sessionId } = connectAndRegister(startPtyServer)

      // モバイルがセッションにアタッチ
      const mobileWs = createMockWs()
      wssState.instance!.emit('connection', mobileWs)
      sendMessage(mobileWs, { type: 'auth', token: 'test-token' })
      sendMessage(mobileWs, { type: 'session_attach', sessionId })
      mobileWs.send.mockClear()

      // プロバイダーが output を送信
      sendMessage(providerWs, { type: 'output', data: 'hello from claude' })

      expect(mobileWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'output', data: 'hello from claude' }),
      )
    })

    it('モバイルの input → プロバイダーへ転送される', () => {
      const { providerWs, sessionId } = connectAndRegister(startPtyServer)

      const mobileWs = createMockWs()
      wssState.instance!.emit('connection', mobileWs)
      sendMessage(mobileWs, { type: 'auth', token: 'test-token' })
      sendMessage(mobileWs, { type: 'session_attach', sessionId })
      providerWs.send.mockClear()

      sendMessage(mobileWs, { type: 'input', data: 'ls\n' })

      expect(providerWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'input', data: 'ls\n' }),
      )
    })

    it('プロバイダーの shell_exit → モバイルへ通知しセッション削除', () => {
      const { providerWs, sessionId } = connectAndRegister(startPtyServer)

      const mobileWs = createMockWs()
      wssState.instance!.emit('connection', mobileWs)
      sendMessage(mobileWs, { type: 'auth', token: 'test-token' })
      sendMessage(mobileWs, { type: 'session_attach', sessionId })
      mobileWs.send.mockClear()

      sendMessage(providerWs, { type: 'shell_exit', exitCode: 0 })

      expect(mobileWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'shell_exit', exitCode: 0 }),
      )

      // セッション削除後は session_list が空になる
      const pickerWs = createMockWs()
      wssState.instance!.emit('connection', pickerWs)
      sendMessage(pickerWs, { type: 'auth', token: 'test-token' })
      const calls = pickerWs.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const sessionList = calls.find((m: any) => m.type === 'session_list')
      expect(sessionList?.sessions.length).toBe(0)
    })

    it('プロバイダーが切断するとセッションが削除されモバイルへ shell_exit が送られる', () => {
      const { providerWs, sessionId } = connectAndRegister(startPtyServer)

      const mobileWs = createMockWs()
      wssState.instance!.emit('connection', mobileWs)
      sendMessage(mobileWs, { type: 'auth', token: 'test-token' })
      sendMessage(mobileWs, { type: 'session_attach', sessionId })
      mobileWs.send.mockClear()

      providerWs.emit('close')

      expect(mobileWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'shell_exit', exitCode: -1 }),
      )
    })

    it('プロバイダーの output がスクロールバックに蓄積され session_attach 時に送信される', () => {
      const { providerWs, sessionId } = connectAndRegister(startPtyServer)

      // プロバイダーが出力を送信
      sendMessage(providerWs, { type: 'output', data: 'line1\n' })
      sendMessage(providerWs, { type: 'output', data: 'line2\n' })

      // 後から接続するモバイルクライアント
      const mobileWs = createMockWs()
      wssState.instance!.emit('connection', mobileWs)
      sendMessage(mobileWs, { type: 'auth', token: 'test-token' })
      sendMessage(mobileWs, { type: 'session_attach', sessionId })

      const calls = mobileWs.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const attached = calls.find((m: any) => m.type === 'session_attached')
      expect(attached?.scrollback).toBe('line1\nline2\n')
    })
  })
})
