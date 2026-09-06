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
