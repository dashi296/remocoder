// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// fs モジュール全体をモックして existsSync を制御可能にする
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(),
  }
})

// ws / node-pty / uuid は pty-server のインポート時に必要
vi.mock('ws', async () => {
  const { EventEmitter } = await import('events')
  class MockWSS extends EventEmitter {
    close = vi.fn()
    constructor(_opts: any) {
      super()
    }
  }
  return { WebSocketServer: MockWSS, WebSocket: { OPEN: 1 } }
})
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  })),
}))
vi.mock('uuid', () => ({ v4: vi.fn().mockReturnValue('test-token') }))

describe('decodeProjectPath', () => {
  let decodeProjectPath: (encodedName: string) => string
  let mockExistsSync: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    const fs = await import('fs')
    mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>
    mockExistsSync.mockReturnValue(false)
    const mod = await import('../pty-server')
    decodeProjectPath = mod.decodeProjectPath
  })

  it('シンプルなパスを正しくデコードする', () => {
    mockExistsSync.mockImplementation((p: unknown) =>
      ['/Users', '/Users/foo', '/Users/foo/myproject'].includes(p as string),
    )
    expect(decodeProjectPath('-Users-foo-myproject')).toBe('/Users/foo/myproject')
  })

  it('Claude encoding: _ → - のため encoded名が "-my-project" でも実際は my_project をデコードする', () => {
    // Claude は '/' も '_' も '-' にエンコードするため、
    // ディスク上の my_project は encoded名では my-project になる
    mockExistsSync.mockImplementation((p: unknown) =>
      ['/Users', '/Users/foo', '/Users/foo/my_project'].includes(p as string),
    )
    expect(decodeProjectPath('-Users-foo-my-project')).toBe('/Users/foo/my_project')
  })

  it('ongli_plus: ongli が存在しても ongli_plus を正しくデコードする', () => {
    // 実ケース: /projects/ongli と /projects/ongli_plus が共存
    // encoded名は -Users-shunokada-projects-ongli-plus（_→- 変換済み）
    mockExistsSync.mockImplementation((p: unknown) =>
      [
        '/Users',
        '/Users/shunokada',
        '/Users/shunokada/projects',
        '/Users/shunokada/projects/ongli',
        '/Users/shunokada/projects/ongli_plus',
      ].includes(p as string),
    )
    expect(decodeProjectPath('-Users-shunokada-projects-ongli-plus')).toBe(
      '/Users/shunokada/projects/ongli_plus',
    )
  })

  it('portfolio_v2: portfolio ディレクトリが存在しなくても正しくデコードする', () => {
    mockExistsSync.mockImplementation((p: unknown) =>
      [
        '/Users',
        '/Users/shunokada',
        '/Users/shunokada/projects',
        '/Users/shunokada/projects/portfolio_v2',
      ].includes(p as string),
    )
    expect(decodeProjectPath('-Users-shunokada-projects-portfolio-v2')).toBe(
      '/Users/shunokada/projects/portfolio_v2',
    )
  })

  it('ongli-plus が削除済みの場合はフォールバックを返す（getRecentProjects でフィルタされる）', () => {
    // ongli は存在するが ongli-plus / ongli_plus はどちらも存在しない
    mockExistsSync.mockImplementation((p: unknown) =>
      [
        '/Users',
        '/Users/shunokada',
        '/Users/shunokada/projects',
        '/Users/shunokada/projects/ongli',
      ].includes(p as string),
    )
    const result = decodeProjectPath('-Users-shunokada-projects-ongli-plus')
    // フォールバックは存在しないパスなので getRecentProjects で除外される
    expect(result).not.toBe('/Users/shunokada/projects/ongli_plus')
    expect(result).not.toBe('/Users/shunokada/projects/ongli')
  })

  it('my_project-frontend: my_project が存在しても my_project-frontend を正しくデコードする', () => {
    // encoded名: -Users-foo-projects-my-project-frontend
    // 候補: my_project/frontend, my-project/frontend, my_project-frontend, my-project-frontend 等
    mockExistsSync.mockImplementation((p: unknown) =>
      [
        '/Users',
        '/Users/foo',
        '/Users/foo/projects',
        '/Users/foo/projects/my_project',
        '/Users/foo/projects/my_project-frontend',
      ].includes(p as string),
    )
    expect(decodeProjectPath('-Users-foo-projects-my-project-frontend')).toBe(
      '/Users/foo/projects/my_project-frontend',
    )
  })
})
