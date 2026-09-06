// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  parseFrontmatter,
  createScanContext,
  scanCommandsDir,
  scanSkillsDir,
  MAX_FILES,
  resolveEnabledPlugins,
  scanPlugins,
} from '../slash-command-scanner'

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

  it('直下の .md をファイル名から命名する', () => {
    write('commands/commit.md', '---\ndescription: Create a git commit\n---\n')
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result).toEqual([
      { name: 'commit', description: 'Create a git commit', scope: 'user' },
    ])
  })

  it('サブディレクトリを呼び出し名に含めず namespace に入れる', () => {
    write('commands/ci/build.md', '---\ndescription: Build\n---\n')
    const result = scanCommandsDir(join(tmp, 'commands'), 'project', createScanContext())
    expect(result).toEqual([
      { name: 'build', description: 'Build', scope: 'project', namespace: 'project:ci' },
    ])
  })

  it('frontmatter の name を無視してファイル名を使う', () => {
    write('commands/actual.md', '---\nname: ignored\ndescription: d\n---\n')
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result[0].name).toBe('actual')
  })

  it('.md 以外を無視する', () => {
    write('commands/readme.txt', 'text')
    write('commands/ok.md', '---\ndescription: d\n---\n')
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['ok'])
  })

  it('存在しないディレクトリでは空配列を返す', () => {
    expect(scanCommandsDir(join(tmp, 'nope'), 'user', createScanContext())).toEqual([])
  })

  it('description を 120 文字に切り詰める', () => {
    write('commands/long.md', `---\ndescription: ${'あ'.repeat(200)}\n---\n`)
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result[0].description!.length).toBe(120)
  })

  it('frontmatter がないファイルも description なしで採用する', () => {
    write('commands/bare.md', '# 本文だけ\n')
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result).toEqual([{ name: 'bare', scope: 'user' }])
  })

  it('最大深度 3 を超えるディレクトリを走査しない', () => {
    write('commands/a/b/c/deep.md', '---\ndescription: d\n---\n')
    write('commands/a/shallow.md', '---\ndescription: d\n---\n')
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['shallow'])
  })

  it('最大ファイル数に達したら truncated を立てて打ち切る', () => {
    for (let i = 0; i < MAX_FILES + 10; i++) {
      write(`commands/cmd${i}.md`, '---\ndescription: d\n---\n')
    }
    const ctx = createScanContext()
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', ctx)
    expect(result.length).toBe(MAX_FILES)
    expect(ctx.truncated).toBe(true)
  })

  it('タイムアウト済みの context では走査せず truncated を立てる', () => {
    write('commands/commit.md', '---\ndescription: d\n---\n')
    const ctx = createScanContext()
    ctx.deadline = Date.now() - 1
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', ctx)
    expect(result).toEqual([])
    expect(ctx.truncated).toBe(true)
  })

  it('シンボリックリンクのディレクトリを追う', () => {
    write('external/linked.md', '---\ndescription: d\n---\n')
    mkdirSync(join(tmp, 'commands'), { recursive: true })
    symlinkSync(join(tmp, 'external'), join(tmp, 'commands', 'sub'), 'dir')
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['linked'])
  })

  it('循環リンクで無限ループしない', () => {
    mkdirSync(join(tmp, 'commands'), { recursive: true })
    symlinkSync(join(tmp, 'commands'), join(tmp, 'commands', 'loop'), 'dir')
    const result = scanCommandsDir(join(tmp, 'commands'), 'user', createScanContext())
    expect(result).toEqual([])
  })

  it('スキルをディレクトリ名から命名する', () => {
    write('skills/brainstorming/SKILL.md', '---\nname: brainstorming\ndescription: d\n---\n')
    const result = scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())
    expect(result).toEqual([{ name: 'brainstorming', description: 'd', scope: 'user' }])
  })

  it('user-invocable: false のスキルを除外する', () => {
    write('skills/internal/SKILL.md', '---\ndescription: d\nuser-invocable: false\n---\n')
    write('skills/public/SKILL.md', '---\ndescription: d\n---\n')
    const result = scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())
    expect(result.map((c) => c.name)).toEqual(['public'])
  })

  it('SKILL.md がないディレクトリを無視する', () => {
    mkdirSync(join(tmp, 'skills', 'empty'), { recursive: true })
    expect(scanSkillsDir(join(tmp, 'skills'), 'user', createScanContext())).toEqual([])
  })

  it('プラグインのスキルに pluginName を付けて名前空間化する', () => {
    write('skills/review/SKILL.md', '---\ndescription: d\n---\n')
    const result = scanSkillsDir(join(tmp, 'skills'), 'plugin', createScanContext(), 'my-plugin')
    expect(result).toEqual([
      { name: 'my-plugin:review', description: 'd', scope: 'plugin', pluginName: 'my-plugin' },
    ])
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

  it('enabledPlugins が true のプラグインだけを返す', () => {
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

    const roots = resolveEnabledPlugins(pluginsDir, settingsPaths)
    expect(roots.map((r) => r.name)).toEqual(['on-plugin'])
  })

  it('enabledPlugins に載っていないプラグインを除外する', () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'x', '1.0.0')
    makePlugin(p, { name: 'x-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'x@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: {} }],
    )
    expect(resolveEnabledPlugins(pluginsDir, settingsPaths)).toEqual([])
  })

  it('後ろの設定ファイルが前の設定を上書きする', () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'x', '1.0.0')
    makePlugin(p, { name: 'x-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'x@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'x@mp': true } }, { enabledPlugins: { 'x@mp': false } }],
    )
    expect(resolveEnabledPlugins(pluginsDir, settingsPaths)).toEqual([])
  })

  it('plugin.json の name を使う（レジストリのキーではなく）', () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'registry-key', '1.0.0')
    makePlugin(p, { name: 'manifest-name' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'registry-key@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'registry-key@mp': true } }],
    )
    expect(resolveEnabledPlugins(pluginsDir, settingsPaths)[0].name).toBe('manifest-name')
  })

  it('manifest の skills パス指定を反映する', () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'custom', '1.0.0')
    makePlugin(p, { name: 'custom', skills: './my-skills/' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'custom@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'custom@mp': true } }],
    )
    const roots = resolveEnabledPlugins(pluginsDir, settingsPaths)
    expect(roots[0].skillsDirs).toEqual([join(p, 'my-skills')])
  })

  it('manifest のパス指定がなければ commands/ と skills/ を使う', () => {
    const p = join(tmp, 'plugins', 'cache', 'mp', 'default', '1.0.0')
    makePlugin(p, { name: 'default-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'default@mp': [{ scope: 'user', installPath: p, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'default@mp': true } }],
    )
    const roots = resolveEnabledPlugins(pluginsDir, settingsPaths)
    expect(roots[0].commandsDirs).toEqual([join(p, 'commands')])
    expect(roots[0].skillsDirs).toEqual([join(p, 'skills')])
  })

  it('pluginsDir の外を指す installPath を無視する', () => {
    const outside = join(tmp, 'outside', '1.0.0')
    makePlugin(outside, { name: 'outside-plugin' })
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'o@mp': [{ scope: 'user', installPath: outside, version: '1.0.0' }] } },
      [{ enabledPlugins: { 'o@mp': true } }],
    )
    expect(resolveEnabledPlugins(pluginsDir, settingsPaths)).toEqual([])
  })

  it('相対パスの installPath を無視する', () => {
    const { pluginsDir, settingsPaths } = setup(
      { version: 2, plugins: { 'r@mp': [{ scope: 'user', installPath: 'relative/path', version: '1.0.0' }] } },
      [{ enabledPlugins: { 'r@mp': true } }],
    )
    expect(resolveEnabledPlugins(pluginsDir, settingsPaths)).toEqual([])
  })

  it('installed_plugins.json がなくても空配列を返す', () => {
    expect(resolveEnabledPlugins(join(tmp, 'missing'), [])).toEqual([])
  })

  it('installed_plugins.json が壊れていても空配列を返す', () => {
    const pluginsDir = join(tmp, 'plugins')
    mkdirSync(pluginsDir, { recursive: true })
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), '{ broken', 'utf-8')
    expect(resolveEnabledPlugins(pluginsDir, [])).toEqual([])
  })

  it('同一プラグインの複数レコードを最初の1件に正規化する', () => {
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
    expect(resolveEnabledPlugins(pluginsDir, settingsPaths).length).toBe(1)
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

  it('プラグインのコマンドとスキルを名前空間付きで返す', () => {
    const cmdDir = join(tmp, 'commands')
    const skillDir = join(tmp, 'skills', 'review')
    mkdirSync(cmdDir, { recursive: true })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(cmdDir, 'commit.md'), '---\ndescription: c\n---\n', 'utf-8')
    writeFileSync(join(skillDir, 'SKILL.md'), '---\ndescription: s\n---\n', 'utf-8')

    const result = scanPlugins(
      [{ name: 'my-plugin', commandsDirs: [cmdDir], skillsDirs: [join(tmp, 'skills')] }],
      createScanContext(),
    )

    expect(result).toEqual([
      { name: 'my-plugin:commit', description: 'c', scope: 'plugin', pluginName: 'my-plugin' },
      { name: 'my-plugin:review', description: 's', scope: 'plugin', pluginName: 'my-plugin' },
    ])
  })

  it('存在しないディレクトリを無視する', () => {
    const result = scanPlugins(
      [{ name: 'p', commandsDirs: [join(tmp, 'none')], skillsDirs: [join(tmp, 'none2')] }],
      createScanContext(),
    )
    expect(result).toEqual([])
  })
})
