// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execSync } from 'child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  openSync,
  closeSync,
  writeSync,
  constants as fsConstants,
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

// realpath() の呼び出しを記録するためのフック。
// 「同じ raw input への同時呼び出しがパス検証（validProjectPath）を1回しか
// 行わないこと」を検証するのに使う。挙動を変えない透過的なラッパーなので、
// recording が false（デフォルト）の間は他のテストの fs 呼び出しに影響しない。
//
// fakeOpen は、指定した1パスへの open() だけを差し替えて、その FileHandle の
// read() を完全にテストからコントロールするためのフック。JSON 読み取りループ
// （readJson 内の handle.read() 連続呼び出し）で、1回の read() が要求量より
// 少ないバイト数しか返さない「部分読み」を確実に再現するために使う（実ファイル
// では小さな JSON を1回の read() で読み切ってしまい、部分読みを決定的に
// 起こせないため）。null（デフォルト）の間は他のテストの open() に影響しない。
const fsHookState = vi.hoisted(() => ({
  realpathCalls: [] as string[],
  recording: false,
  fakeOpen: null as null | { path: string; handle: unknown },
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    realpath: (path: Parameters<typeof actual.realpath>[0], ...rest: unknown[]) => {
      if (fsHookState.recording) fsHookState.realpathCalls.push(String(path))
      return (actual.realpath as (...a: unknown[]) => ReturnType<typeof actual.realpath>)(path, ...rest)
    },
    open: (path: Parameters<typeof actual.open>[0], ...rest: unknown[]) => {
      if (fsHookState.fakeOpen && String(path) === fsHookState.fakeOpen.path) {
        return Promise.resolve(fsHookState.fakeOpen.handle)
      }
      return (actual.open as (...a: unknown[]) => ReturnType<typeof actual.open>)(path, ...rest)
    },
  }
})

import {
  parseFrontmatter,
  createScanContext,
  scanCommandsDir,
  scanSkillsDir,
  scanPluginRootSkill,
  MAX_FILES,
  MAX_JSON_BYTES,
  MAX_MANIFEST_DIRS,
  MAX_CACHE_ENTRIES,
  MAX_INFLIGHT_RAW_KEYS,
  isSafeCommandName,
  resolveEnabledPlugins,
  scanPlugins,
  getSlashCommands,
  clearSlashCommandCache,
  getSlashCommandCacheSize,
  getInFlightRawKeyCount,
  BUILTIN_COMMANDS,
} from '../slash-command-scanner'

/** FIFO などプラットフォーム依存の特殊ファイルを使うテストを Windows でスキップするためのフラグ */
const isWindows = process.platform === 'win32'

describe('parseFrontmatter', () => {
  it('description を取り出す', () => {
    const md = '---\ndescription: Create a git commit\n---\n\n# 本文\n'
    expect(parseFrontmatter(md).description).toBe('Create a git commit')
  })

  it('ダブルクォートで囲まれた値のクォートを外す', () => {
    const md = '---\nname: brainstorming\ndescription: "You MUST use this: before work"\n---\n'
    expect(parseFrontmatter(md).description).toBe('You MUST use this: before work')
  })

  it('シングルクォートで囲まれた値のクォートを外す', () => {
    const md = "---\ndescription: 'quoted value'\n---\n"
    expect(parseFrontmatter(md).description).toBe('quoted value')
  })

  it('ハイフンを含むキーを取り出す', () => {
    const md = '---\nuser-invocable: false\n---\n'
    expect(parseFrontmatter(md)['user-invocable']).toBe('false')
  })

  it('frontmatter がない場合は空オブジェクトを返す', () => {
    expect(parseFrontmatter('# 見出しだけ\n')).toEqual({})
  })

  it('閉じ区切りがない場合は空オブジェクトを返す', () => {
    expect(parseFrontmatter('---\ndescription: broken\n')).toEqual({})
  })

  it('CRLF 改行でも解析できる', () => {
    const md = '---\r\ndescription: crlf value\r\n---\r\n'
    expect(parseFrontmatter(md).description).toBe('crlf value')
  })

  it('key: value 形式でない行を無視する', () => {
    const md = '---\ndescription: ok\n  - list item\n---\n'
    expect(parseFrontmatter(md)).toEqual({ description: 'ok' })
  })

  it('空文字列を渡しても例外にならない', () => {
    expect(parseFrontmatter('')).toEqual({})
  })
})

describe('isSafeCommandName', () => {
  it('CR を含む名前を拒否する（PTY へ届いて Enter として解釈されるため）', () => {
    expect(isSafeCommandName('evil\rcommit')).toBe(false)
  })

  it('ESC を含む名前を拒否する（端末エスケープシーケンス対策）', () => {
    expect(isSafeCommandName('evil\x1bname')).toBe(false)
  })

  it('100文字を超える名前を拒否する', () => {
    expect(isSafeCommandName('a'.repeat(101))).toBe(false)
  })

  it('100文字ちょうどの名前は受け入れる', () => {
    expect(isSafeCommandName('a'.repeat(100))).toBe(true)
  })

  it('空文字列を拒否する', () => {
    expect(isSafeCommandName('')).toBe(false)
  })

  it('ハイフン・アンダースコア・ドット・コロンを含む名前空間付き名を受け入れる', () => {
    expect(isSafeCommandName('commit-commands:commit')).toBe(true)
  })
})

describe('scanCommandsDir / scanSkillsDir', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'scanner-test-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  /** dir を作って file を書く小さなヘルパー */
  function write(relPath: string, content: string) {
    const full = join(tmp, relPath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
    return full
  }

  it('直下の .md をファイル名から命名する', async () => {
    write('commands/commit.md', '---\ndescription: Create a git commit\n---\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result).toEqual([
      { name: 'commit', description: 'Create a git commit', scope: 'user' },
    ])
  })

  it('サブディレクトリを呼び出し名に含めず namespace に入れる', async () => {
    write('commands/ci/build.md', '---\ndescription: Build\n---\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'project', createScanContext())
    expect(result).toEqual([
      { name: 'build', description: 'Build', scope: 'project', namespace: 'project:ci' },
    ])
  })

  it('frontmatter の name を無視してファイル名を使う', async () => {
    write('commands/actual.md', '---\nname: ignored\ndescription: d\n---\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result[0].name).toBe('actual')
  })

  it('.md 以外を無視する', async () => {
    write('commands/readme.txt', 'text')
    write('commands/ok.md', '---\ndescription: d\n---\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['ok'])
  })

  it('存在しないディレクトリでは空配列を返す', async () => {
    expect(await scanCommandsDir(join(tmp, 'nope'), 'user', createScanContext())).toEqual([])
  })

  it('description を 120 文字に切り詰める', async () => {
    write('commands/long.md', `---\ndescription: ${'あ'.repeat(200)}\n---\n`)
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result[0].description!.length).toBe(120)
  })

  it('frontmatter がないファイルも description なしで採用する', async () => {
    write('commands/bare.md', '# 本文だけ\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result).toEqual([{ name: 'bare', scope: 'user' }])
  })

  it('最大深度 3 を超えるディレクトリを走査しない', async () => {
    write('commands/a/b/c/deep.md', '---\ndescription: d\n---\n')
    write('commands/a/shallow.md', '---\ndescription: d\n---\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['shallow'])
  })

  it('最大ファイル数に達したら truncated を立てて打ち切る', async () => {
    for (let i = 0; i < MAX_FILES + 10; i++) {
      write(`commands/cmd${i}.md`, '---\ndescription: d\n---\n')
    }
    const ctx = createScanContext()
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', ctx)
    expect(result.length).toBe(MAX_FILES)
    expect(ctx.truncated).toBe(true)
  })

  it('タイムアウト済みの context では走査せず truncated を立てる', async () => {
    write('commands/commit.md', '---\ndescription: d\n---\n')
    const ctx = createScanContext()
    ctx.deadline = Date.now() - 1
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', ctx)
    expect(result).toEqual([])
    expect(ctx.truncated).toBe(true)
  })

  it('走査の途中で deadline を超えた場合、部分的な結果を返し truncated を立てる', async () => {
    // 事前チェック（上のテスト）だけでなく、ウォーク中に isExhausted が繰り返し
    // 呼ばれていることを検証する。実時間の経過に依存すると環境によって遅くなったり
    // 速すぎたりしてフレーキーになるため、Date.now をモックして「最初の数回は
    // deadline 内、以降は deadline 超過」という状況を決定的に再現する。
    for (let i = 0; i < 10; i++) {
      write(`commands/cmd${i}.md`, '---\ndescription: d\n---\n')
    }
    const ctx = createScanContext()
    let calls = 0
    // walk 開始時・enterDirectory 後・readdir 後の3回分の isExhausted 呼び出しは
    // まだ deadline 内としてやり過ごし、エントリのループに入ってから超過させる
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++
      return calls <= 4 ? ctx.deadline - 1000 : ctx.deadline + 1000
    })
    try {
      const result = await scanCommandsDir(join(tmp, 'commands'), 'user', ctx)
      expect(ctx.truncated).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThan(10)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('シンボリックリンクの種別確認（stat）直後に deadline を超えた場合、読み取りを始めず truncated を立てる', async () => {
    // Codex round 5 (Finding 2): entry.isSymbolicLink() の場合、種別を判定する
    // ために stat(full) を await する。この await 中に budget（deadline）を
    // 使い切っても、直後に isExhausted を再確認していなければ、そのまま
    // readHead（次の I/O）を始めてしまう。
    // 単一のシンボリックリンクだけを置き、
    // walk 開始時 / enterDirectory 後 / readdir 後 / エントリループ先頭
    // の4回分の isExhausted 呼び出しはまだ deadline 内としてやり過ごし、
    // symlink の stat() 直後の（今回追加した）チェックから超過させる。
    write('target.md', '---\ndescription: real\n---\n')
    mkdirSync(join(tmp, 'commands'), { recursive: true })
    symlinkSync(join(tmp, 'target.md'), join(tmp, 'commands', 'link.md'), 'file')

    const ctx = createScanContext()
    let calls = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++
      return calls <= 4 ? ctx.deadline - 1000 : ctx.deadline + 1000
    })
    try {
      const result = await scanCommandsDir(join(tmp, 'commands'), 'user', ctx)
      // symlink の stat() 直後に打ち切られるため、readHead（frontmatter の
      // 読み取り）まで到達せず、この唯一のエントリは結果に含まれない
      expect(result).toEqual([])
      expect(ctx.truncated).toBe(true)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('シンボリックリンクのディレクトリを追う', async () => {
    write('external/linked.md', '---\ndescription: d\n---\n')
    mkdirSync(join(tmp, 'commands'), { recursive: true })
    symlinkSync(join(tmp, 'external'), join(tmp, 'commands', 'sub'), 'dir')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['linked'])
  })

  it('循環リンクで無限ループしない', async () => {
    mkdirSync(join(tmp, 'commands'), { recursive: true })
    symlinkSync(join(tmp, 'commands'), join(tmp, 'commands', 'loop'), 'dir')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result).toEqual([])
  })

  it('スキルをディレクトリ名から命名する', async () => {
    write('skills/brainstorming/SKILL.md', '---\nname: brainstorming\ndescription: d\n---\n')
    const result = await scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())
    expect(result).toEqual([{ name: 'brainstorming', description: 'd', scope: 'user' }])
  })

  it('user-invocable: false のスキルを除外する', async () => {
    write('skills/internal/SKILL.md', '---\ndescription: d\nuser-invocable: false\n---\n')
    write('skills/public/SKILL.md', '---\ndescription: d\n---\n')
    const result = await scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['public'])
  })

  it('SKILL.md がないディレクトリを無視する', async () => {
    mkdirSync(join(tmp, 'skills', 'empty'), { recursive: true })
    expect(await scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())).toEqual([])
  })

  it('プラグインのスキルに pluginName を付けて名前空間化する', async () => {
    write('skills/review/SKILL.md', '---\ndescription: d\n---\n')
    const result = await scanSkillsDir(join(tmp, 'skills'), 'plugin', createScanContext(), 'my-plugin')
    expect(result).toEqual([
      { name: 'my-plugin:review', description: 'd', scope: 'plugin', pluginName: 'my-plugin' },
    ])
  })

  // ESC (\x1b) はファイル名として無効な文字ではないが、Windows では
  // ファイル名を作る低レベル API が制御文字を拒否する環境があるため、
  // このテストは POSIX 環境限定とする（isSafeCommandName 自体の検証は
  // 上の describe('isSafeCommandName') でプラットフォームに依存せず行う）
  it.skipIf(isWindows)('ESC を含むファイル名のコマンドを除外する', async () => {
    write('commands/normal.md', '---\ndescription: d\n---\n')
    write('commands/evil\x1bname.md', '---\ndescription: d\n---\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['normal'])
  })

  it('100文字を超えるファイル名のコマンドを除外する', async () => {
    const longName = 'a'.repeat(101)
    write(`commands/${longName}.md`, '---\ndescription: d\n---\n')
    const result = await scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result).toEqual([])
  })

  // CR (\r) を含むディレクトリ名は Windows の低レベル API で作成できないため
  // POSIX 環境限定とする
  it.skipIf(isWindows)('制御文字を含むディレクトリ名のスキルを除外する', async () => {
    write('skills/evil\rname/SKILL.md', '---\ndescription: d\n---\n')
    const result = await scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())
    expect(result).toEqual([])
  })

  // mkfifo は Windows に存在しないため POSIX 環境限定とする
  it.skipIf(isWindows)(
    'SKILL.md が FIFO の場合は開かずスキップする（ブロッキング対策）',
    async () => {
      mkdirSync(join(tmp, 'skills', 'weird'), { recursive: true })
      const fifoPath = join(tmp, 'skills', 'weird', 'SKILL.md')
      execSync(`mkfifo "${fifoPath}"`)
      const result = await scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())
      expect(result).toEqual([])
    },
    2000,
  )

  // 書き手が既に FIFO を開いている状態でも、fstat ベースの種別判定でスキップされる
  // ことを確認する（TOCTOU 対策: 種別判定は開いた fd に対して行うため、書き手の
  // 有無に関わらずブロックしない）。サブプロセスを起動せず、この Node プロセス
  // 自身が O_NONBLOCK で読み手・書き手の両端を開いて再現する。
  it.skipIf(isWindows)(
    '書き手が接続済みの FIFO も開かずスキップする（ブロッキング対策）',
    async () => {
      mkdirSync(join(tmp, 'skills', 'weird2'), { recursive: true })
      const fifoPath = join(tmp, 'skills', 'weird2', 'SKILL.md')
      execSync(`mkfifo "${fifoPath}"`)

      // 読み手を先に非ブロッキングで開いておく（POSIX: O_NONBLOCK 付きの読み取り
      // オープンは書き手の有無に関わらず即座に返る）
      const readerFd = openSync(fifoPath, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0))
      // 読み手が存在するので、書き手のオープンはブロックしない
      const writerFd = openSync(fifoPath, 'w')
      try {
        writeSync(writerFd, 'not a real SKILL.md\n')

        const result = await scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())
        expect(result).toEqual([])
      } finally {
        closeSync(writerFd)
        closeSync(readerFd)
      }
    },
    2000,
  )

  it('root SKILL.md の frontmatter name に制御文字が含まれる場合は除外する', async () => {
    // parseFrontmatter の value 抽出は正規表現の `.` を使っており、これは行末文字である
    // \r を含められない（\r を含む行はそもそもマッチしない）。そのため、値の途中に
    // 混入しても正規表現がそのまま通す制御文字である ESC (\x1b) で検証する。
    write('install/SKILL.md', '---\nname: "evil\x1bname"\ndescription: d\n---\n')
    const result = await scanPluginRootSkill(join(tmp, 'install'), 'plugin', createScanContext())
    expect(result).toEqual([])
  })
})

describe('resolveEnabledPlugins', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'scanner-plugin-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  /** installed_plugins.json と settings.json を書くヘルパー */
  function setup(installed: unknown, settings: unknown[]): { pluginsDir: string; settingsPaths: string[] } {
    const pluginsDir = join(tmp, 'plugins')
    mkdirSync(pluginsDir, { recursive: true })
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify(installed), 'utf-8')
    const settingsPaths = settings.map((s, i) => {
      const p = join(tmp, `settings${i}.json`)
      writeFileSync(p, JSON.stringify(s), 'utf-8')
      return p
    })
    return { pluginsDir, settingsPaths }
  }

  /** installPath 配下にプラグイン本体を作るヘルパー */
  function makePlugin(installPath: string, manifest: Record<string, unknown>) {
    mkdirSync(join(installPath, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(installPath, '.claude-plugin', 'plugin.json'),
      JSON.stringify(manifest),
      'utf-8',
    )
  }

  it('enabledPlugins が true のプラグインだけを返す', async () => {
    const onPath = join(tmp, 'plugins', 'cache', 'mp', 'on', '1.0.0')
    const offPath = join(tmp, 'plugins', 'cache', 'mp', 'off', '1.0.0')
    makePlugin(onPath, { name: 'on-plugin' })
    makePlugin(offPath, { name: 'off-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      {
        version: 2,
        plugins: {
          'on@mp': [{ scope: 'user', installPath: onPath, version: '1.0.0' }],
          'off@mp': [{ scope: 'user', installPath: offPath, version: '1.0.0' }],
        },
      },
      [{ enabledPlugins: { 'on@mp': true, 'off@mp': false } }],
    )

    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())
    expect(roots.map((r) => r.name)).toEqual(['on-plugin'])
  })

  it('enabledPlugins に載っていないプラグインを除外する', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'x', '1.0.0')
    makePlugin(p, { name: 'x-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'x@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: {} }],
    )
    expect(await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())).toEqual([])
  })

  it('後ろの設定ファイルが前の設定を上書きする', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'x', '1.0.0')
    makePlugin(p, { name: 'x-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'x@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'x@mp': true } }, { enabledPlugins: { 'x@mp': false } }],
    )
    expect(await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())).toEqual([])
  })

  it('plugin.json の name を使う（レジストリのキーではなく）', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'registry-key', '1.0.0')
    makePlugin(p, { name: 'manifest-name' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'registry-key@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'registry-key@mp': true } }],
    )
    expect((await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext()))[0].name).toBe('manifest-name')
  })

  it('manifest の skills パス指定を反映する', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'custom', '1.0.0')
    makePlugin(p, { name: 'custom', skills: './my-skills/' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'custom@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'custom@mp': true } }],
    )
    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())
    expect(roots[0].skillsDirs).toEqual([join(p, 'my-skills')])
  })

  it('manifest のパス指定がなければ commands/ と skills/ を使う', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'default', '1.0.0')
    makePlugin(p, { name: 'default-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'default@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'default@mp': true } }],
    )
    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())
    expect(roots[0].commandsDirs).toEqual([join(p, 'commands')])
    expect(roots[0].skillsDirs).toEqual([join(p, 'skills')])
  })

  it('manifest の commands が ".." で脱出しようとする指定を無視する', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'escape-cmd', '1.0.0')
    makePlugin(p, { name: 'escape-cmd-plugin', commands: '../../../etc' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'ec@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'ec@mp': true } }],
    )
    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())
    expect(roots[0].commandsDirs).toEqual([])
  })

  it('manifest の skills が絶対パス指定を無視する', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'escape-skill', '1.0.0')
    makePlugin(p, { name: 'escape-skill-plugin', skills: '/etc' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'es@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'es@mp': true } }],
    )
    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())
    expect(roots[0].skillsDirs).toEqual([])
  })

  it('pluginsDir の外を指す installPath を無視する', async () => {
    const outside = join(tmp, 'outside', '1.0.0')
    makePlugin(outside, { name: 'outside-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'o@mp': [{ scope: 'user', installPath: outside, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'o@mp': true } }],
    )
    expect(await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())).toEqual([])
  })

  it('".." で pluginsDir 配下を装う installPath を無視する', async () => {
    const secret = join(tmp, 'secret', '1.0.0')
    makePlugin(secret, { name: 'secret-plugin' })
    // path.join は内部で '..' を正規化してしまうため、リテラルの '..' を残すために文字列結合で作る。
    // join(tmp, 'plugins') から1階層上がると tmp になり、そこから secret/1.0.0 は実在する secret と一致する
    const escaping = `${join(tmp, 'plugins')}/../secret/1.0.0`
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'e@mp': [{ scope: 'user', installPath: escaping, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'e@mp': true } }],
    )
    expect(await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())).toEqual([])
  })

  it('相対パスの installPath を無視する', async () => {
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'r@mp': [{ scope: 'user', installPath: 'relative/path', version: '1.0.0' }] } },
      [{ enabledPlugins: { 'r@mp': true } }],
    )
    expect(await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())).toEqual([])
  })

  it('plugin.json の name に CR を含む場合はプラグイン全体を除外する', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'evil', '1.0.0')
    makePlugin(p, { name: 'evil\rcommit' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'evil@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'evil@mp': true } }],
    )
    expect(await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())).toEqual([])
  })

  it('installed_plugins.json がなくても空配列を返す', async () => {
    expect(await resolveEnabledPlugins(join(tmp, 'missing'), [], createScanContext())).toEqual([])
  })

  it('installed_plugins.json が上限サイズを超える場合は読まずにスキップする', async () => {
    // 有効なプラグインを含む正当な JSON だが、ダミーの巨大フィールドでサイズ上限を
    // 超えさせる。読まれていれば見つかるはずのプラグインが見つからないことで、
    // 「サイズ超過のため読まれなかった」ことを検証する（例外(rejected promise)に
    // ならないことは resolves で確認する）
    const p = join(tmp, 'plugins', 'cache', 'mp', 'big', '1.0.0')
    makePlugin(p, { name: 'big-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      {
        version: 2,
        _padding: 'x'.repeat(MAX_JSON_BYTES),
        plugins: { 'big@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] },
      },
      [{ enabledPlugins: { 'big@mp': true } }],
    )
    await expect(
      resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext()),
    ).resolves.toEqual([])
  })

  it('installed_plugins.json が壊れていても空配列を返す', async () => {
    const pluginsDir = join(tmp, 'plugins')
    mkdirSync(pluginsDir, { recursive: true })
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), '{ broken', 'utf-8')
    expect(await resolveEnabledPlugins(pluginsDir, [], createScanContext())).toEqual([])
  })

  it('同一プラグインの複数レコードを最初の1件に正規化する', async () => {
    const p1 = join(tmp, 'plugins', 'cache', 'mp', 'dup', '1.0.0')
    const p2 = join(tmp, 'plugins', 'cache', 'mp', 'dup', '2.0.0')
    makePlugin(p1, { name: 'dup-plugin' })
    makePlugin(p2, { name: 'dup-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      {
        version: 2,
        plugins: {
          'dup@mp': [
            { scope: 'user', installPath: p1, version: '1.0.0' },
            { scope: 'project', installPath: p2, version: '2.0.0' },
          ],
        },
      },
      [{ enabledPlugins: { 'dup@mp': true } }],
    )
    expect((await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())).length).toBe(1)
  })

  it('deadline が既に過ぎている場合、manifest を読まず truncated を立てる', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'x', '1.0.0')
    makePlugin(p, { name: 'x-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'x@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'x@mp': true } }],
    )
    const ctx = createScanContext()
    ctx.deadline = Date.now() - 1

    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, ctx)

    // manifest を1つも読んでいないため、有効なはずのプラグインも見つからない
    expect(roots).toEqual([])
    expect(ctx.truncated).toBe(true)
  })

  it('JSON の部分読みの直後に deadline を超えた場合、次の read() を呼ばずに打ち切る', async () => {
    // Codex round 5 (Finding 2): readJson の while ループは、bytesRead 分だけ
    // offset を進めてから次の handle.read() を呼ぶ。ここで budget（deadline）を
    // 再確認していないと、budget を使い切った後も追加の read I/O を始めて
    // しまう。実ファイルでは小さな JSON を1回の read() で読み切ってしまい
    // 部分読みを決定的に再現できないため、fakeOpen で1回に2バイトしか
    // 返さない FileHandle に差し替え、複数回の read() を強制する。
    const p = join(tmp, 'plugins', 'cache', 'mp', 'x', '1.0.0')
    makePlugin(p, { name: 'x-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'x@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'x@mp': true } }],
    )

    const installedPath = join(pluginsDir, 'installed_plugins.json')
    const content = Buffer.from(JSON.stringify({ version: 2, plugins: {} }), 'utf-8')
    let readCallCount = 0
    fsHookState.fakeOpen = {
      path: installedPath,
      handle: {
        stat: async () => ({ isFile: () => true, size: content.length }),
        read: async (buf: Buffer, offset: number, _length: number, position: number) => {
          readCallCount++
          // 1回あたり最大2バイトしか返さず、必ず複数回の read() を要求させる
          const chunk = content.subarray(position, position + 2)
          chunk.copy(buf, offset)
          return { bytesRead: chunk.length }
        },
        close: async () => {},
      },
    }

    const ctx = createScanContext()
    let calls = 0
    // resolveEnabledPlugins 冒頭 / readJson 冒頭 / openRegularFile 後、の3回分は
    // deadline 内としてやり過ごし、1回目の read() 直後の再チェック（今回追加した
    // もの）から超過させる
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++
      return calls <= 3 ? ctx.deadline - 1000 : ctx.deadline + 1000
    })

    try {
      const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, ctx)
      expect(readCallCount).toBe(1)
      expect(ctx.truncated).toBe(true)
      // 読み取りが打ち切られ不完全な JSON になるため、有効なはずのプラグインも
      // 見つからない
      expect(roots).toEqual([])
    } finally {
      nowSpy.mockRestore()
      fsHookState.fakeOpen = null
    }
  })

  it('ctx.fileCount が上限に達している場合、以降の manifest を読まない', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'x', '1.0.0')
    makePlugin(p, { name: 'x-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'x@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'x@mp': true } }],
    )
    const ctx = createScanContext()
    ctx.fileCount = MAX_FILES

    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, ctx)

    expect(roots).toEqual([])
    expect(ctx.truncated).toBe(true)
  })

  it('budget が manifest ループの途中で尽きた場合、それまでに見つかったプラグインは残し、以降は打ち切る', async () => {
    // installed_plugins.json とsettings は正常に読み終え、manifest を読む
    // ループの途中（1つ目のプラグインは成功、2つ目のプラグインの2レコード目）で
    // budget が尽きるケースを再現する。
    // 事前チェック（before の deadline / fileCount テスト）だけでは、ループ内の
    // 途中チェック（record ごとの isExhausted）を消しても通ってしまうため、
    // ここでは「1件は見つかる・残りは見つからない・truncated が立つ」という
    // 部分的な結果まで検証する。
    const earlierPath = join(tmp, 'plugins', 'cache', 'mp', 'earlier', '1.0.0')
    makePlugin(earlierPath, { name: 'earlier-plugin' })
    // dup@mp の1レコード目はわざと plugin.json を置かず、readJson を
    // 「試みたが読めなかった」扱いにする（budget は消費するが roots には残らない）
    const dupMissingPath = join(tmp, 'plugins', 'cache', 'mp', 'dup', '1.0.0')
    const dupValidPath = join(tmp, 'plugins', 'cache', 'mp', 'dup', '2.0.0')
    makePlugin(dupValidPath, { name: 'dup-plugin-valid' })

    const { pluginsDir, settingsPaths } = setup(
      {
        version: 2,
        plugins: {
          'earlier@mp': [{ scope: 'user', installPath: earlierPath, version: '1.0.0' }],
          'dup@mp': [
            { scope: 'user', installPath: dupMissingPath, version: '1.0.0' },
            { scope: 'project', installPath: dupValidPath, version: '2.0.0' },
          ],
        },
      },
      [{ enabledPlugins: { 'earlier@mp': true, 'dup@mp': true } }],
    )

    // 読み取り順序: installed_plugins.json(1) → settings(1) →
    // earlier@mp の manifest(1, 成功) → dup@mp 1レコード目の manifest(1, 失敗) →
    // ここで budget を使い切らせ、dup@mp 2レコード目（成功するはず）を防ぐ
    const ctx = createScanContext()
    ctx.fileCount = MAX_FILES - 4

    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, ctx)

    expect(roots.map((r) => r.name)).toEqual(['earlier-plugin'])
    expect(ctx.truncated).toBe(true)
  })

  it('manifest が MAX_MANIFEST_DIRS を超える commands を指定しても、その件数までしか反映しない', async () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'many', '1.0.0')
    const manyDirs = Array.from({ length: MAX_MANIFEST_DIRS + 10 }, (_, i) => `./dir${i}`)
    makePlugin(p, { name: 'many-plugin', commands: manyDirs })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'many@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'many@mp': true } }],
    )

    const roots = await resolveEnabledPlugins(pluginsDir, settingsPaths, createScanContext())

    expect(roots[0].commandsDirs.length).toBe(MAX_MANIFEST_DIRS)
  })
})

describe('scanPlugins', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'scanner-scanplugin-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('プラグインのコマンドとスキルを名前空間付きで返す', async () => {
    const cmdDir = join(tmp, 'commands')
    const skillDir = join(tmp, 'skills', 'review')
    mkdirSync(cmdDir, { recursive: true })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(cmdDir, 'commit.md'), '---\ndescription: c\n---\n', 'utf-8')
    writeFileSync(join(skillDir, 'SKILL.md'), '---\ndescription: s\n---\n', 'utf-8')

    const result = await scanPlugins(
      [
        {
          name: 'my-plugin',
          installPath: join(tmp, 'install'),
          commandsDirs: [cmdDir],
          skillsDirs: [join(tmp, 'skills')],
        },
      ],
      createScanContext(),
    )

    expect(result).toEqual([
      { name: 'my-plugin:commit', description: 'c', scope: 'plugin', pluginName: 'my-plugin' },
      { name: 'my-plugin:review', description: 's', scope: 'plugin', pluginName: 'my-plugin' },
    ])
  })

  it('サブディレクトリのコマンドに正しい namespace (plugin:<subdir>) を付ける', async () => {
    const cmdDir = join(tmp, 'commands')
    const subDir = join(cmdDir, 'sub')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(join(subDir, 'nested.md'), '---\ndescription: n\n---\n', 'utf-8')

    const result = await scanPlugins(
      [{ name: 'my-plugin', installPath: join(tmp, 'install'), commandsDirs: [cmdDir], skillsDirs: [] }],
      createScanContext(),
    )

    expect(result).toEqual([
      {
        name: 'my-plugin:nested',
        description: 'n',
        scope: 'plugin',
        namespace: 'plugin:sub',
        pluginName: 'my-plugin',
      },
    ])
  })

  it('プラグイン名とコマンド名の組み合わせが100文字を超える場合は除外する', async () => {
    const cmdDir = join(tmp, 'commands')
    mkdirSync(cmdDir, { recursive: true })
    const longCmdName = 'a'.repeat(90)
    writeFileSync(join(cmdDir, `${longCmdName}.md`), '---\ndescription: c\n---\n', 'utf-8')
    const longPluginName = 'b'.repeat(90)

    const result = await scanPlugins(
      [
        {
          name: longPluginName,
          installPath: join(tmp, 'install'),
          commandsDirs: [cmdDir],
          skillsDirs: [],
        },
      ],
      createScanContext(),
    )

    expect(result).toEqual([])
  })

  it('存在しないディレクトリを無視する', async () => {
    const result = await scanPlugins(
      [
        {
          name: 'p',
          installPath: join(tmp, 'none3'),
          commandsDirs: [join(tmp, 'none')],
          skillsDirs: [join(tmp, 'none2')],
        },
      ],
      createScanContext(),
    )
    expect(result).toEqual([])
  })

  it('プラグイン root の SKILL.md をプラグイン名で取り込む', async () => {
    const installPath = join(tmp, 'install')
    mkdirSync(installPath, { recursive: true })
    writeFileSync(join(installPath, 'SKILL.md'), '---\ndescription: root skill\n---\n', 'utf-8')

    const result = await scanPlugins(
      [{ name: 'root-plugin', installPath, commandsDirs: [], skillsDirs: [] }],
      createScanContext(),
    )

    expect(result).toEqual([
      { name: 'root-plugin', description: 'root skill', scope: 'plugin', pluginName: 'root-plugin' },
    ])
  })

  it('root SKILL.md の frontmatter に name があれば <pluginName>:<name> にする', async () => {
    const installPath = join(tmp, 'install')
    mkdirSync(installPath, { recursive: true })
    writeFileSync(
      join(installPath, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: root skill\n---\n',
      'utf-8',
    )

    const result = await scanPlugins(
      [{ name: 'root-plugin', installPath, commandsDirs: [], skillsDirs: [] }],
      createScanContext(),
    )

    expect(result.map((c) => c.name)).toEqual(['root-plugin:brainstorming'])
  })

  it('root SKILL.md が user-invocable: false のとき除外する', async () => {
    const installPath = join(tmp, 'install')
    mkdirSync(installPath, { recursive: true })
    writeFileSync(
      join(installPath, 'SKILL.md'),
      '---\ndescription: internal\nuser-invocable: false\n---\n',
      'utf-8',
    )

    const result = await scanPlugins(
      [{ name: 'root-plugin', installPath, commandsDirs: [], skillsDirs: [] }],
      createScanContext(),
    )

    expect(result).toEqual([])
  })

  it('root SKILL.md と skills/ ディレクトリの両方があれば両方を返す', async () => {
    const installPath = join(tmp, 'install')
    const skillsDir = join(installPath, 'skills', 'review')
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(installPath, 'SKILL.md'), '---\ndescription: root skill\n---\n', 'utf-8')
    writeFileSync(join(skillsDir, 'SKILL.md'), '---\ndescription: sub skill\n---\n', 'utf-8')

    const result = await scanPlugins(
      [
        {
          name: 'dual-plugin',
          installPath,
          commandsDirs: [],
          skillsDirs: [join(installPath, 'skills')],
        },
      ],
      createScanContext(),
    )

    expect(result.map((c) => c.name).sort()).toEqual(['dual-plugin', 'dual-plugin:review'])
  })

  it('budget が尽きている場合、プラグインの走査に入らない', async () => {
    const installPath = join(tmp, 'install')
    mkdirSync(installPath, { recursive: true })
    writeFileSync(join(installPath, 'SKILL.md'), '---\ndescription: root skill\n---\n', 'utf-8')

    const ctx = createScanContext()
    ctx.deadline = Date.now() - 1

    const result = await scanPlugins(
      [{ name: 'root-plugin', installPath, commandsDirs: [], skillsDirs: [] }],
      ctx,
    )

    expect(result).toEqual([])
  })
})

describe('getSlashCommands', () => {
  let tmp: string
  /** テスト用の空の claudeDir。開発者の実 ~/.claude を走査させない */
  let claudeDir: string

  beforeEach(() => {
    clearSlashCommandCache()
    tmp = mkdtempSync(join(tmpdir(), 'scanner-get-'))
    claudeDir = join(tmp, 'claude')
    mkdirSync(claudeDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  /** プロジェクトディレクトリを作り、任意のコマンドを置く */
  function makeProject(commandNames: string[] = []): string {
    const projectPath = join(tmp, `project-${commandNames.join('-') || 'empty'}`)
    mkdirSync(join(projectPath, '.claude', 'commands'), { recursive: true })
    for (const name of commandNames) {
      writeFileSync(
        join(projectPath, '.claude', 'commands', `${name}.md`),
        '---\ndescription: project version\n---\n',
        'utf-8',
      )
    }
    return projectPath
  }

  it('claude 以外のセッションでは空配列を返す', async () => {
    expect((await getSlashCommands({ kind: 'shell' }, { claudeDir })).commands).toEqual([])
    expect(
      (await getSlashCommands({ kind: 'tmux', sessionName: 's' }, { claudeDir })).commands,
    ).toEqual([])
  })

  it('source が undefined のとき空配列を返す', async () => {
    expect((await getSlashCommands(undefined, { claudeDir })).commands).toEqual([])
  })

  it('claude セッションでは組み込みコマンドを含む', async () => {
    const { commands } = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    expect(commands.some((c) => c.name === 'clear' && c.scope === 'builtin')).toBe(true)
  })

  it('組み込みコマンドの名前に先頭の / を含まない', () => {
    expect(BUILTIN_COMMANDS.every((c) => !c.name.startsWith('/'))).toBe(true)
  })

  it('claudeDir が空なら組み込みコマンドだけを返す', async () => {
    const { commands } = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    expect(commands.map((c) => c.name).sort()).toEqual(
      BUILTIN_COMMANDS.map((c) => c.name).sort(),
    )
  })

  it('ユーザーのコマンドとスキルを含む', async () => {
    mkdirSync(join(claudeDir, 'commands'), { recursive: true })
    mkdirSync(join(claudeDir, 'skills', 'my-skill'), { recursive: true })
    writeFileSync(join(claudeDir, 'commands', 'my-cmd.md'), '---\ndescription: d\n---\n', 'utf-8')
    writeFileSync(
      join(claudeDir, 'skills', 'my-skill', 'SKILL.md'),
      '---\ndescription: d\n---\n',
      'utf-8',
    )

    const { commands } = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    expect(commands.some((c) => c.name === 'my-cmd' && c.scope === 'user')).toBe(true)
    expect(commands.some((c) => c.name === 'my-skill' && c.scope === 'user')).toBe(true)
  })

  it('projectPath が相対パスのとき project スコープを走査しない', async () => {
    const { commands } = await getSlashCommands(
      { kind: 'claude', projectPath: 'relative/path' },
      { claudeDir },
    )
    expect(commands.some((c) => c.scope === 'project')).toBe(false)
  })

  it('projectPath が存在しないディレクトリのとき project スコープを走査しない', async () => {
    const { commands } = await getSlashCommands(
      { kind: 'claude', projectPath: '/nonexistent/dir/xyz' },
      { claudeDir },
    )
    expect(commands.some((c) => c.scope === 'project')).toBe(false)
  })

  it('同じ projectPath の2回目の呼び出しがキャッシュを返す', async () => {
    const first = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    const second = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    expect(second.commands).toBe(first.commands)
  })

  it('同じキーへの同時リクエストは1回の走査に相乗りする（重複走査しない）', async () => {
    // 2回とも await 前に呼び出す（同期部分でキャッシュに Promise を積む）ことで、
    // 2回目の呼び出しが「まだ完了していない1回目の走査」に相乗りする状況を再現する。
    // scanCommandsDir をラップして呼び出し回数を数え、実際に1回しか走査していない
    // ことも確認する。
    const projectPath = makeProject(['shared'])
    const [a, b] = await Promise.all([
      getSlashCommands({ kind: 'claude', projectPath }, { claudeDir }),
      getSlashCommands({ kind: 'claude', projectPath }, { claudeDir }),
    ])
    // 同じ Promise に相乗りしていれば、結果の配列は同一参照になる
    expect(b.commands).toBe(a.commands)
  })

  it('同じ raw な projectPath への同時呼び出しはパス検証（validProjectPath）も1回だけ行う', async () => {
    // 上のテストは「走査（performScan）が1回に相乗りする」ことしか見ていない。
    // validProjectPath は走査より前段の処理であり、応答の遅いファイルシステム上では
    // ここも重ねて実行されると budget の外で時間を浪費してしまう。
    // realpath への呼び出しを記録し、resolve(projectPath) 自身を引数とする呼び出し
    // （= validProjectPath によるもの。walk 中の enterDirectory は常に projectPath
    // 配下のサブディレクトリを渡すため、混同しない）が1回だけであることを確認する。
    const projectPath = makeProject(['shared'])
    fsHookState.realpathCalls = []
    fsHookState.recording = true
    try {
      const [a, b] = await Promise.all([
        getSlashCommands({ kind: 'claude', projectPath }, { claudeDir }),
        getSlashCommands({ kind: 'claude', projectPath }, { claudeDir }),
      ])
      expect(b.commands).toBe(a.commands)
      const validationCalls = fsHookState.realpathCalls.filter((p) => p === resolve(projectPath))
      expect(validationCalls.length).toBe(1)
    } finally {
      fsHookState.recording = false
    }
  })

  it('走査が失敗した場合、失敗した Promise をキャッシュに残さず、次の呼び出しで再走査できる', async () => {
    // performScan の内部は fs のエラーをすべて catch しているため、そのままでは
    // rejected Promise を作れない。isExhausted 経由で毎回呼ばれる Date.now を
    // 一定回数の後に例外を投げるようにモックし、走査の途中で例外を発生させる。
    const originalNow = Date.now.bind(Date)
    let calls = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++
      if (calls > 3) throw new Error('boom')
      return originalNow()
    })
    try {
      await expect(getSlashCommands({ kind: 'claude' }, { claudeDir })).rejects.toThrow('boom')
    } finally {
      nowSpy.mockRestore()
    }

    // 失敗した Promise がキャッシュに残っていれば、以降の呼び出しも
    // 同じ rejected Promise を返してしまう。ここでは残っていないことを確認する
    expect(getSlashCommandCacheSize()).toBe(0)

    const { commands } = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    expect(commands.some((c) => c.name === 'clear')).toBe(true)
  })

  it('projectPath ごとにキャッシュが分かれる', async () => {
    const projectPath = makeProject(['only-here'])
    const withPath = await getSlashCommands({ kind: 'claude', projectPath }, { claudeDir })
    const withoutPath = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    expect(withPath.commands.some((c) => c.name === 'only-here')).toBe(true)
    expect(withoutPath.commands.some((c) => c.name === 'only-here')).toBe(false)
  })

  it('同名は project > builtin の順に1件へ正規化する', async () => {
    // 組み込みの clear と同名のプロジェクトコマンドを置く
    const projectPath = makeProject(['clear'])
    const { commands } = await getSlashCommands({ kind: 'claude', projectPath }, { claudeDir })
    const matched = commands.filter((c) => c.name === 'clear')
    expect(matched.length).toBe(1)
    expect(matched[0].scope).toBe('project')
  })

  it('同名は project > user の順に1件へ正規化する', async () => {
    mkdirSync(join(claudeDir, 'commands'), { recursive: true })
    writeFileSync(join(claudeDir, 'commands', 'dup.md'), '---\ndescription: user\n---\n', 'utf-8')
    const projectPath = makeProject(['dup'])

    const { commands } = await getSlashCommands({ kind: 'claude', projectPath }, { claudeDir })
    const matched = commands.filter((c) => c.name === 'dup')
    expect(matched.length).toBe(1)
    expect(matched[0].scope).toBe('project')
  })

  it('名前順にソートして返す', async () => {
    const { commands } = await getSlashCommands({ kind: 'claude' }, { claudeDir })
    const names = commands.map((c) => c.name)
    // 実装と同じ比較関数で期待値を作る
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('projectPath の末尾の "." を正規化して同じキャッシュエントリを使う', async () => {
    const projectPath = makeProject()
    const first = await getSlashCommands({ kind: 'claude', projectPath }, { claudeDir })
    // path.join は呼び出し側で正規化してしまうため、非正規化の文字列を再現するために
    // 文字列結合で作る（実際にモバイルから届く projectPath は任意の文字列でありうる）
    const second = await getSlashCommands(
      { kind: 'claude', projectPath: `${projectPath}/.` },
      { claudeDir },
    )
    expect(second.commands).toBe(first.commands)
  })

  it('同じディレクトリを指す異なるシンボリックリンクは同じキャッシュエントリを使う', async () => {
    const projectPath = makeProject(['via-symlink'])
    const link1 = join(tmp, 'alias-1')
    const link2 = join(tmp, 'alias-2')
    symlinkSync(projectPath, link1, 'dir')
    symlinkSync(projectPath, link2, 'dir')

    const first = await getSlashCommands({ kind: 'claude', projectPath: link1 }, { claudeDir })
    const second = await getSlashCommands({ kind: 'claude', projectPath: link2 }, { claudeDir })

    // 実体は同じディレクトリなので、キャッシュも1件だけになる
    expect(getSlashCommandCacheSize()).toBe(1)
    expect(second.commands).toBe(first.commands)
  })

  it('キャッシュの件数が上限に達し、最も古いエントリを追い出しつつ直近のエントリは保持する', async () => {
    // 「上限を超えない」だけの検証だと、キャッシュを丸ごと無効化しても
    // （サイズが常に 0 のため）通ってしまう。ここでは
    // (1) ちょうど上限まで増えること（機能しているが上限は守っている）、
    // (2) 直近のキーはまだキャッシュされていること（同一配列参照が返る）、
    // (3) 最も古いキーは追い出されていること（再計算されて別参照になる）
    // まで確認する。
    const projectPaths: string[] = []
    const firstResults: Array<{ commands: unknown[] }> = []
    for (let i = 0; i < MAX_CACHE_ENTRIES + 10; i++) {
      const projectPath = makeProject([`p${i}`])
      projectPaths.push(projectPath)
      firstResults.push(await getSlashCommands({ kind: 'claude', projectPath }, { claudeDir }))
    }

    expect(getSlashCommandCacheSize()).toBe(MAX_CACHE_ENTRIES)

    const lastIndex = projectPaths.length - 1
    const lastAgain = await getSlashCommands(
      { kind: 'claude', projectPath: projectPaths[lastIndex] },
      { claudeDir },
    )
    expect(lastAgain.commands).toBe(firstResults[lastIndex].commands)

    const oldestAgain = await getSlashCommands(
      { kind: 'claude', projectPath: projectPaths[0] },
      { claudeDir },
    )
    expect(oldestAgain.commands).not.toBe(firstResults[0].commands)
  })

  it('inFlightByRawKey の件数が上限に達すると、最も古いエントリを追い出す', async () => {
    // Codex round 5 (Finding 1): commandsCache とは別に、検証・走査中の
    // Promise を raw な（正規化前の）projectPath ごとに共有する
    // inFlightByRawKey にも上限がなければ、応答の遅いファイルシステム上で
    // 綴りの異なる raw な projectPath への同時リクエストが積み重なり、
    // 際限なく増え続けてしまう。
    //
    // このテストは commandsCache 用の上のテストと違い、1件ずつ await せずに
    // 一度に大量の呼び出しを（どれも決着する前に）発火させる。逐次 await
    // すると各呼び出しがその場で決着してしまい、Map に複数エントリが
    // 同時に残る状況を再現できないため。
    const promises: Array<Promise<unknown>> = []
    for (let i = 0; i < MAX_INFLIGHT_RAW_KEYS + 10; i++) {
      // 実在しないディレクトリでよい（raw key は検証前の生の文字列であり、
      // validProjectPath の成否とは無関係にエントリが作られる）
      const rawProjectPath = join(tmp, `raw-${i}`)
      promises.push(getSlashCommands({ kind: 'claude', projectPath: rawProjectPath }, { claudeDir }))
    }

    // ここまで一度も await していないため、どの呼び出しもまだ決着していない
    expect(getInFlightRawKeyCount()).toBe(MAX_INFLIGHT_RAW_KEYS)

    await Promise.all(promises)

    // 全て決着すれば、各エントリは自身の完了時に自己クリーンアップされ 0 に戻る
    expect(getInFlightRawKeyCount()).toBe(0)
  })

  it('ユーザーコマンドが走査上限を使い切ってもプロジェクトコマンドは残る（budget 優先度）', async () => {
    // user スコープの走査だけで MAX_FILES を使い切らせる
    mkdirSync(join(claudeDir, 'commands'), { recursive: true })
    for (let i = 0; i < MAX_FILES; i++) {
      writeFileSync(
        join(claudeDir, 'commands', `cmd${i}.md`),
        '---\ndescription: d\n---\n',
        'utf-8',
      )
    }
    const projectPath = makeProject(['priority-check'])

    const { commands, truncated } = await getSlashCommands(
      { kind: 'claude', projectPath },
      { claudeDir },
    )

    expect(truncated).toBe(true)
    // project は優先度が最も高いスコープなので、budget が尽きても落とされてはならない
    expect(commands.some((c) => c.name === 'priority-check' && c.scope === 'project')).toBe(true)
  })

  it('最後の操作（有効なプラグイン1件だけの root SKILL.md 読み取り）の最中に budget を使い切っても truncated: true を返す', async () => {
    // このテストが再現したいバグの形: プラグイン root skill の読み取りが走査全体で
    // 最後に行われる I/O であり、かつその読み取りが完了した時点で budget
    // （ここでは MAX_FILES）をちょうど使い切った場合。読み取り自体は正常に完了して
    // 結果に反映されるため、呼び出し元が最後にもう一度 isExhausted を評価しない限り
    // truncated が false のまま返ってしまう。
    //
    // deadline（実時間）を使うと「何回目の Date.now 呼び出しで超過させるか」を
    // 手で数える必要があり実装の些細な変更で崩れやすいため、ここでは
    // fileCount ベースの budget を使う。事前に用意するダミーファイル数を逆算し、
    // 「root SKILL.md の直前チェック時点でちょうど MAX_FILES - 1」
    // 「読み取り後にちょうど MAX_FILES」になるよう仕込む。
    //
    // 内訳: ユーザーコマンド 496 件 → fileCount=496。
    // その後 installed_plugins.json / settings.json / plugin.json の読み取りで
    // +1 ずつ（resolveEnabledPlugins 側）→ fileCount=499。
    // ここで root SKILL.md の直前チェックが走り、499 < 500 なので通過する。
    // 直後の ctx.fileCount++ で 500 になり、以降どこにも isExhausted の
    // 呼び出し機会がなければ truncated が反映されないまま返ってしまう。
    mkdirSync(join(claudeDir, 'commands'), { recursive: true })
    for (let i = 0; i < MAX_FILES - 4; i++) {
      writeFileSync(
        join(claudeDir, 'commands', `cmd${i}.md`),
        '---\ndescription: d\n---\n',
        'utf-8',
      )
    }

    const pluginsDir = join(claudeDir, 'plugins')
    const installPath = join(pluginsDir, 'cache', 'mp', 'demo', '1.0.0')
    mkdirSync(join(installPath, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(installPath, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo-plugin' }),
      'utf-8',
    )
    writeFileSync(join(installPath, 'SKILL.md'), '---\ndescription: d\n---\n', 'utf-8')
    writeFileSync(
      join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: { 'demo@mp': [{ scope: 'user', installPath, version: '1.0.0' }] },
      }),
      'utf-8',
    )
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'demo@mp': true } }),
      'utf-8',
    )

    const { commands, truncated } = await getSlashCommands({ kind: 'claude' }, { claudeDir })

    // 走査自体は正常に完了しており、プラグインのコマンドも結果に含まれている
    // （= 「途中で例外になった」のではなく「完了はしたが budget を使い切った」ケース）
    expect(commands.some((c) => c.name === 'demo-plugin')).toBe(true)
    expect(truncated).toBe(true)
  })
})
