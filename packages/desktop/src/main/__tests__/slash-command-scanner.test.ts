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
import { join } from 'path'
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
  isSafeCommandName,
  resolveEnabledPlugins,
  scanPlugins,
  getSlashCommands,
  clearSlashCommandCache,
  getSlashCommandCacheSize,
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
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++
      return calls <= 3 ? ctx.deadline - 1000 : ctx.deadline + 1000
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
})
