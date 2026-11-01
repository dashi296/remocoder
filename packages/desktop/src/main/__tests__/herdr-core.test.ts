// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockExecAsync = vi.hoisted(() => vi.fn())

vi.mock('child_process', async () => {
  const { promisify } = await import('util')
  const exec = vi.fn()
  ;(exec as any)[promisify.custom] = mockExecAsync
  return { exec }
})

import {
  parseHerdrCoreList,
  herdrCoreEnv,
  herdrCoreAttachArgs,
  herdrCoreSocketCandidates,
  findHerdrCoreSocket,
  isHerdrCoreRunning,
  collectHerdrCoreSessions,
  parseHerdrCoreStatusMessage,
} from '../herdr-core'

describe('parseHerdrCoreList', () => {
  it('hc ls --json の terminals をセッション情報へ変換する', () => {
    const stdout = JSON.stringify({
      hidden_finished: 0,
      terminals: [
        { address: 't2', agent: 'claude-code', cwd: '/p/math-card', state: 'live', status: 'done', turn: 3, where: 'math-card / 1' },
        { address: 't9', agent: 'zsh', cwd: '/p/ongli', state: 'live', turn: 0, where: 'remocoder / 1' },
      ],
    })
    expect(parseHerdrCoreList(stdout)).toEqual([
      {
        tool: 'herdr-core',
        sessionName: 't2',
        detail: 'math-card / 1',
        workingDirectory: '/p/math-card',
        agent: 'claude-code',
        agentStatus: 'done',
        agentStatusMessage: undefined,
      },
      {
        tool: 'herdr-core',
        sessionName: 't9',
        detail: 'remocoder / 1',
        workingDirectory: '/p/ongli',
        agent: 'zsh',
        agentStatus: undefined,
        agentStatusMessage: undefined,
      },
    ])
  })

  it('status がオブジェクト形式の場合は state と msg を取り出す', () => {
    const stdout = JSON.stringify({
      terminals: [{ address: 't4', state: 'live', status: { state: 'blocked', msg: 'approve Bash?', app: 'claude-code' } }],
    })
    const [s] = parseHerdrCoreList(stdout)
    expect(s.agentStatus).toBe('blocked')
    expect(s.agentStatusMessage).toBe('approve Bash?')
  })

  it('未知の status は undefined にする', () => {
    const stdout = JSON.stringify({ terminals: [{ address: 't1', state: 'live', status: 'sleeping' }] })
    expect(parseHerdrCoreList(stdout)[0].agentStatus).toBeUndefined()
  })

  it('別マシンのアドレス・終了済み・不正なアドレスは除外する', () => {
    const stdout = JSON.stringify({
      terminals: [
        { address: 'vps/t7', state: 'live' },
        { address: 't3', state: 'finished' },
        { address: 't1; rm -rf /', state: 'live' },
        { address: '--help', state: 'live' },
        { state: 'live' },
        { address: 't5', state: 'live' },
        { address: '_named', state: 'live' },
      ],
    })
    expect(parseHerdrCoreList(stdout).map((s) => s.sessionName)).toEqual(['t5', '_named'])
  })

  it('error 応答は例外にする', () => {
    const stdout = JSON.stringify({ error: { kind: 'unavailable', message: 'cannot start core' } })
    expect(() => parseHerdrCoreList(stdout)).toThrow('cannot start core')
  })
})

describe('herdrCoreEnv', () => {
  it('HC_TERMINAL_ID と HC_SCOPE を取り除き、それ以外は保持する', () => {
    const env = herdrCoreEnv({ PATH: '/bin', HC_TERMINAL_ID: 't10', HC_SCOPE: 'x', HC_TERMINAL_SOCKET: '/s.sock' })
    expect(env).toEqual({ PATH: '/bin', HC_TERMINAL_SOCKET: '/s.sock' })
  })
})

describe('herdrCoreAttachArgs', () => {
  it('スクロールバック付きで attach する', () => {
    expect(herdrCoreAttachArgs('t2')).toEqual(['attach', '--history', '1000', 't2'])
  })
})

describe('parseHerdrCoreStatusMessage', () => {
  it('status.msg を返す', () => {
    expect(parseHerdrCoreStatusMessage(JSON.stringify({ status: { state: 'done', msg: 'PR #171 fixed' } }))).toBe('PR #171 fixed')
  })
  it('status が null なら undefined', () => {
    expect(parseHerdrCoreStatusMessage(JSON.stringify({ status: null }))).toBeUndefined()
  })
})

describe('herdrCoreSocketCandidates', () => {
  it('macOS 既定: state ディレクトリの <session>/<session>.sock', () => {
    expect(herdrCoreSocketCandidates({ XDG_STATE_HOME: '/nonexistent-state' })).toEqual([
      '/nonexistent-state/herdr-core/default/default.sock',
    ])
  })

  it('XDG_RUNTIME_DIR と HC_SESSION を反映し、HC_TERMINAL_SOCKET > HC_SOCKET の順に優先する', () => {
    expect(
      herdrCoreSocketCandidates({
        HC_TERMINAL_SOCKET: '/t.sock',
        HC_SOCKET: '/h.sock',
        HC_SESSION: 'work',
        XDG_RUNTIME_DIR: '/run/user/1000',
        XDG_STATE_HOME: '/nonexistent-state',
      }),
    ).toEqual([
      '/t.sock',
      '/h.sock',
      '/run/user/1000/herdr-core/work.sock',
      '/nonexistent-state/herdr-core/work/work.sock',
    ])
  })

  it('core.lock に書かれた実際のソケットパスを既定パスより優先する', () => {
    const state = mkdtempSync(join(tmpdir(), 'hc-lock-'))
    try {
      mkdirSync(join(state, 'herdr-core', 'default'), { recursive: true })
      writeFileSync(join(state, 'herdr-core', 'default', 'core.lock'), '/custom/core.sock\n')
      expect(herdrCoreSocketCandidates({ XDG_STATE_HOME: state })).toEqual([
        '/custom/core.sock',
        join(state, 'herdr-core', 'default', 'default.sock'),
      ])
    } finally {
      rmSync(state, { recursive: true, force: true })
    }
  })
})

describe('isHerdrCoreRunning / collectHerdrCoreSessions', () => {
  let dir: string
  let server: Server | null = null

  beforeEach(() => {
    mockExecAsync.mockReset()
    dir = mkdtempSync(join(tmpdir(), 'hc-test-'))
  })

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()))
    server = null
    rmSync(dir, { recursive: true, force: true })
  })

  it('ソケットが存在しなければ false', async () => {
    expect(await isHerdrCoreRunning(join(dir, 'none.sock'))).toBe(false)
  })

  it('ソケットが接続を受け付ければ true', async () => {
    const sock = join(dir, 'core.sock')
    server = createServer((c) => c.end())
    await new Promise<void>((r) => server!.listen(sock, () => r()))
    expect(await isHerdrCoreRunning(sock)).toBe(true)
  })

  const SOCKET_ENV_KEYS = ['XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'HC_TERMINAL_SOCKET', 'HC_SOCKET', 'HC_SESSION'] as const

  /** ソケット解決に関わる環境変数を一時ディレクトリだけに向けて fn を実行する（CI の XDG_RUNTIME_DIR などを遮断） */
  function withSocketDir(fn: () => Promise<void>) {
    return async () => {
      const prev = Object.fromEntries(SOCKET_ENV_KEYS.map((k) => [k, process.env[k]]))
      for (const k of SOCKET_ENV_KEYS) delete process.env[k]
      process.env.XDG_STATE_HOME = dir
      try {
        await fn()
      } finally {
        for (const k of SOCKET_ENV_KEYS) {
          if (prev[k] === undefined) delete process.env[k]
          else process.env[k] = prev[k]
        }
      }
    }
  }

  it('候補のうち接続を受け付ける最初のソケットを返す', withSocketDir(async () => {
    const live = join(dir, 'live.sock')
    server = createServer((c) => c.end())
    await new Promise<void>((r) => server!.listen(live, () => r()))
    // 応答しない HC_TERMINAL_SOCKET を飛ばし、次の候補 HC_SOCKET を採用する
    expect(await findHerdrCoreSocket({ HC_TERMINAL_SOCKET: join(dir, 'dead.sock'), HC_SOCKET: live, XDG_STATE_HOME: dir })).toBe(live)
    // どの候補も応答しなければ null
    expect(await findHerdrCoreSocket({ HC_SOCKET: join(dir, 'dead.sock'), XDG_STATE_HOME: dir })).toBeNull()
  }))

  it('コア停止中は hc を実行せず空配列を返す（hc ls がコアを起動するのを防ぐ）', withSocketDir(async () => {
    expect(await collectHerdrCoreSessions()).toEqual([])
    expect(mockExecAsync).not.toHaveBeenCalled()
  }))

  it('状態を報告しているターミナルのみ hc get でメッセージを補い、失敗は無視する', withSocketDir(async () => {
    const { mkdirSync } = await import('fs')
    mkdirSync(join(dir, 'herdr-core', 'default'), { recursive: true })
    server = createServer((c) => c.end())
    await new Promise<void>((r) => server!.listen(join(dir, 'herdr-core', 'default', 'default.sock'), () => r()))

    mockExecAsync.mockImplementation(async (cmd: string) => {
      if (cmd.endsWith('ls --json')) {
        return {
          stdout: JSON.stringify({
            terminals: [
              { address: 't1', state: 'live', status: 'done' },
              { address: 't2', state: 'live', status: 'working' },
              { address: 't3', state: 'live' },
            ],
          }),
        }
      }
      if (cmd.includes('get t1 ')) return { stdout: JSON.stringify({ status: { state: 'done', msg: 'all green' } }) }
      throw new Error('boom')
    })

    const result = await collectHerdrCoreSessions()
    expect(result.map((s) => [s.sessionName, s.agentStatusMessage])).toEqual([
      ['t1', 'all green'],
      ['t2', undefined],
      ['t3', undefined],
    ])
    const calls = mockExecAsync.mock.calls.map((c) => c[0] as string)
    expect(calls.some((c) => c.includes('get t3 '))).toBe(false)
    // 確認済みのソケットを HC_SOCKET で渡し、hc が別のコアを起動しないようにする
    const lsEnv = mockExecAsync.mock.calls[0][1].env as NodeJS.ProcessEnv
    expect(lsEnv.HC_SOCKET).toBe(join(dir, 'herdr-core', 'default', 'default.sock'))
  }))

  it('remocoder 自身のターミナル（HC_TERMINAL_ID）を除外する', withSocketDir(async () => {
    const { mkdirSync } = await import('fs')
    mkdirSync(join(dir, 'herdr-core', 'default'), { recursive: true })
    server = createServer((c) => c.end())
    await new Promise<void>((r) => server!.listen(join(dir, 'herdr-core', 'default', 'default.sock'), () => r()))
    const prevId = process.env.HC_TERMINAL_ID
    process.env.HC_TERMINAL_ID = 't10'
    try {
      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify({ terminals: [{ address: 't9', state: 'live' }, { address: 't10', state: 'live' }] }),
      })
      expect((await collectHerdrCoreSessions()).map((s) => s.sessionName)).toEqual(['t9'])
    } finally {
      if (prevId === undefined) delete process.env.HC_TERMINAL_ID
      else process.env.HC_TERMINAL_ID = prevId
    }
  }))

  it('hc ls の失敗は警告を出して reject する', withSocketDir(async () => {
    const { mkdirSync } = await import('fs')
    mkdirSync(join(dir, 'herdr-core', 'default'), { recursive: true })
    server = createServer((c) => c.end())
    await new Promise<void>((r) => server!.listen(join(dir, 'herdr-core', 'default', 'default.sock'), () => r()))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mockExecAsync.mockResolvedValue({ stdout: JSON.stringify({ error: { message: 'cannot start core' } }) })
      await expect(collectHerdrCoreSessions()).rejects.toThrow('cannot start core')
      expect(warn).toHaveBeenCalledWith('[herdr-core] failed to list terminals:', expect.stringContaining('cannot start core'))
    } finally {
      warn.mockRestore()
    }
  }))
})
