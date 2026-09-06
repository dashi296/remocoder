# Mobile Slash Command Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイルのターミナル画面から Claude Code のスラッシュコマンドを検索付きシートで選び、入力欄に挿入できるようにする。

**Architecture:** デスクトップ（Electron main）が `~/.claude` と `<projectPath>/.claude` とプラグインを走査してコマンド一覧を作り、WebSocket で `command_list` として返す。モバイルは WebView 経由でそれを受け取り、シートに表示する。並び順はモバイルが AsyncStorage に持つ使用回数で決める。

**Tech Stack:** TypeScript / Electron main（Node fs API のみ、glob ライブラリは追加しない）/ vitest（desktop・shared）/ React Native + jest（mobile）/ ws

**Spec:** `docs/superpowers/specs/2026-09-06-mobile-slash-command-sheet-design.md`

## Global Constraints

- 走査の上限: 最大深度 **3**、最大ファイル数 **500**、1ファイルの読み取りは先頭 **8192 バイト**、走査全体のタイムアウト **3000 ミリ秒**
- キャッシュ TTL: **30000 ミリ秒**。キーは `projectPath ?? '<none>'`
- `description` はデスクトップ側で **120 文字**に切り詰める
- パス検証は**シンボリックリンクを解決する前の文字列**に対して行う。リンク自体は追う
- サブディレクトリは呼び出し名に含めない。`commands/ci/build.md` → 名前は `build`、`namespace` は `project:ci`
- コマンド名の重複解決の優先順位: **project > user > plugin > builtin**
- 依存パッケージを追加しない。走査は Node の `fs` API で実装する
- UI 文言は英語（既存コンポーネントに合わせる）。コード内コメントは日本語
- テストコマンド: desktop は `pnpm --filter @remocoder/desktop test`、mobile は `pnpm --filter @remocoder/mobile test`、shared は `pnpm --filter @remocoder/shared test`

---

### Task 1: frontmatter パーサ

`.md` / `SKILL.md` の先頭 YAML frontmatter から `key: value` を取り出す。ネスト・配列・複数行値は扱わない（`description` と `user-invocable` はいずれも1行に収まる）。

**Files:**
- Create: `packages/desktop/src/main/slash-command-scanner.ts`
- Test: `packages/desktop/src/main/__tests__/slash-command-scanner.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `parseFrontmatter(content: string): Record<string, string>`

- [ ] **Step 1: Write the failing test**

`packages/desktop/src/main/__tests__/slash-command-scanner.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../slash-command-scanner'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: FAIL（`slash-command-scanner` モジュールが存在しない）

- [ ] **Step 3: Write minimal implementation**

`packages/desktop/src/main/slash-command-scanner.ts`:

```typescript
/**
 * Claude Code のスラッシュコマンド（コマンド定義とスキル）を走査して一覧化する。
 *
 * 依存を増やさないため glob ライブラリは使わず Node の fs API のみで実装する。
 */

/**
 * 先頭の YAML frontmatter から `key: value` を抽出する。
 * ネスト・配列・複数行値は扱わない（description と user-invocable は1行に収まる）。
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!matched) return {}

  const result: Record<string, string> = {}
  for (const line of matched[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[2].trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted && value.length >= 2) value = value.slice(1, -1)
    result[kv[1]] = value
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: PASS（9件）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/slash-command-scanner.ts packages/desktop/src/main/__tests__/slash-command-scanner.test.ts
git commit -m "feat: スラッシュコマンド定義の frontmatter パーサを追加"
```

---

### Task 2: ローカルの commands / skills 走査

`~/.claude` と `<projectPath>/.claude` の下から、コマンド定義とスキルを収集する。深度・件数・時間の上限と循環リンク対策を含む。

**Files:**
- Modify: `packages/shared/src/types.ts`（`SlashCommandInfo` を追加）
- Modify: `packages/desktop/src/main/slash-command-scanner.ts`
- Test: `packages/desktop/src/main/__tests__/slash-command-scanner.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter(content: string): Record<string, string>`
- Produces:
  - `SlashCommandInfo`（shared の型。`{ name: string; description?: string; scope: 'builtin'|'user'|'project'|'plugin'; namespace?: string; pluginName?: string }`）
  - `createScanContext(): ScanContext`
  - `ScanContext`（`{ visited: Set<string>; fileCount: number; deadline: number; truncated: boolean }`）
  - `scanCommandsDir(root: string, scope: 'user' | 'project', ctx: ScanContext): SlashCommandInfo[]`
  - `scanSkillsDir(root: string, scope: 'user' | 'project' | 'plugin', ctx: ScanContext, pluginName?: string): SlashCommandInfo[]`
  - `MAX_DEPTH`, `MAX_FILES`, `MAX_HEAD_BYTES`, `SCAN_TIMEOUT_MS`, `DESCRIPTION_MAX_LENGTH`（定数）

- [ ] **Step 1: shared に型を追加**

`packages/shared/src/types.ts` の `ProjectInfo` の定義の直前に追加する:

```typescript
/** スラッシュコマンド（コマンド定義またはスキル）の情報 */
export interface SlashCommandInfo {
  /** 呼び出し名（先頭の / は含まない）。例: "commit", "commit-commands:commit" */
  name: string
  /** frontmatter の description。デスクトップ側で 120 文字に切り詰め済み */
  description?: string
  /** 提供元 */
  scope: 'builtin' | 'user' | 'project' | 'plugin'
  /** 表示用の名前空間注記。例: "project:ci"。呼び出し名には含まれない */
  namespace?: string
  /** scope が 'plugin' のときの plugin.json の name */
  pluginName?: string
}
```

- [ ] **Step 2: Write the failing test**

`packages/desktop/src/main/__tests__/slash-command-scanner.test.ts` の末尾に追加する:

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, afterEach } from 'vitest'
import {
  createScanContext,
  scanCommandsDir,
  scanSkillsDir,
  MAX_FILES,
} from '../slash-command-scanner'

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: FAIL（`createScanContext` などが export されていない）

- [ ] **Step 4: Write minimal implementation**

`packages/desktop/src/main/slash-command-scanner.ts` の `parseFrontmatter` の下に追加する:

```typescript
import { readdirSync, openSync, readSync, closeSync, realpathSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import { SlashCommandInfo } from '@remocoder/shared'

/** 走査の最大深度 */
export const MAX_DEPTH = 3
/** 走査で読むファイルの最大数 */
export const MAX_FILES = 500
/** 1ファイルあたりの読み取りバイト数。frontmatter だけ読めば足りる */
export const MAX_HEAD_BYTES = 8192
/** 走査全体のタイムアウト（ms） */
export const SCAN_TIMEOUT_MS = 3000
/** description の最大長 */
export const DESCRIPTION_MAX_LENGTH = 120

/** 1回の走査で共有する状態。循環リンク・件数・時間の上限を持つ */
export interface ScanContext {
  /** 訪問済みディレクトリの realpath。循環リンク対策 */
  visited: Set<string>
  /** 読んだファイル数 */
  fileCount: number
  /** この時刻を過ぎたら打ち切る */
  deadline: number
  /** 上限に達して打ち切ったか */
  truncated: boolean
}

export function createScanContext(): ScanContext {
  return {
    visited: new Set(),
    fileCount: 0,
    deadline: Date.now() + SCAN_TIMEOUT_MS,
    truncated: false,
  }
}

/** ファイル先頭の maxBytes だけ読む。巨大な Markdown 全体を読まないため */
function readHead(filePath: string, maxBytes = MAX_HEAD_BYTES): string {
  const fd = openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    const read = readSync(fd, buf, 0, maxBytes, 0)
    return buf.subarray(0, read).toString('utf-8')
  } finally {
    closeSync(fd)
  }
}

function truncateDescription(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.length > DESCRIPTION_MAX_LENGTH ? value.slice(0, DESCRIPTION_MAX_LENGTH) : value
}

/** ctx が上限に達していれば true を返し、truncated を立てる */
function isExhausted(ctx: ScanContext): boolean {
  if (ctx.fileCount >= MAX_FILES || Date.now() > ctx.deadline) {
    ctx.truncated = true
    return true
  }
  return false
}

/**
 * ディレクトリに入ってよいかを判定する。
 * realpath で訪問済みを記録し、シンボリックリンクによる循環を防ぐ。
 */
function enterDirectory(dir: string, ctx: ScanContext): boolean {
  let real: string
  try {
    real = realpathSync(dir)
  } catch {
    return false
  }
  if (ctx.visited.has(real)) return false
  ctx.visited.add(real)
  return true
}

/**
 * コマンド定義ディレクトリを走査する。
 * 呼び出し名はファイル名から決まり、サブディレクトリ名は namespace として表示にだけ使う。
 */
export function scanCommandsDir(
  root: string,
  scope: 'user' | 'project',
  ctx: ScanContext,
): SlashCommandInfo[] {
  const results: SlashCommandInfo[] = []

  function walk(dir: string, depth: number, relDir: string) {
    if (depth > MAX_DEPTH) return
    if (isExhausted(ctx)) return
    if (!enterDirectory(dir, ctx)) return

    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (isExhausted(ctx)) return
      const full = join(dir, entry.name)

      // withFileTypes はリンクを解決しないので、リンクの場合は statSync で種別を判定する
      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          const st = statSync(full)
          isDir = st.isDirectory()
          isFile = st.isFile()
        } catch {
          continue
        }
      }

      if (isDir) {
        walk(full, depth + 1, relDir ? `${relDir}/${entry.name}` : entry.name)
        continue
      }
      if (!isFile || !entry.name.endsWith('.md')) continue

      ctx.fileCount++
      let front: Record<string, string> = {}
      try {
        front = parseFrontmatter(readHead(full))
      } catch {
        continue
      }

      const info: SlashCommandInfo = {
        name: basename(entry.name, '.md'),
        scope,
      }
      const description = truncateDescription(front.description)
      if (description) info.description = description
      if (relDir) info.namespace = `${scope}:${relDir}`
      results.push(info)
    }
  }

  walk(root, 0, '')
  return results
}

/**
 * スキルディレクトリ（`<root>/<name>/SKILL.md`）を走査する。
 * 呼び出し名はディレクトリ名。`user-invocable: false` は除外する。
 */
export function scanSkillsDir(
  root: string,
  scope: 'user' | 'project' | 'plugin',
  ctx: ScanContext,
  pluginName?: string,
): SlashCommandInfo[] {
  if (isExhausted(ctx)) return []
  if (!enterDirectory(root, ctx)) return []

  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const results: SlashCommandInfo[] = []
  for (const entry of entries) {
    if (isExhausted(ctx)) break
    const skillDir = join(root, entry.name)
    const skillFile = join(skillDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue

    ctx.fileCount++
    let front: Record<string, string> = {}
    try {
      front = parseFrontmatter(readHead(skillFile))
    } catch {
      continue
    }
    if (front['user-invocable'] === 'false') continue

    const info: SlashCommandInfo = {
      name: pluginName ? `${pluginName}:${entry.name}` : entry.name,
      scope,
    }
    const description = truncateDescription(front.description)
    if (description) info.description = description
    if (pluginName) info.pluginName = pluginName
    results.push(info)
  }
  return results
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: PASS（Task 1 の 9 件と合わせて 25 件）

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/desktop/src/main/slash-command-scanner.ts packages/desktop/src/main/__tests__/slash-command-scanner.test.ts
git commit -m "feat: commands/skills のローカル走査を追加"
```

---

### Task 3: プラグインの解決

`installed_plugins.json` と設定の `enabledPlugins` から、有効なプラグインのコマンド・スキルを収集する。

**Files:**
- Modify: `packages/desktop/src/main/slash-command-scanner.ts`
- Test: `packages/desktop/src/main/__tests__/slash-command-scanner.test.ts`

**Interfaces:**
- Consumes: `scanCommandsDir`, `scanSkillsDir`, `createScanContext`, `ScanContext`
- Produces:
  - `resolveEnabledPlugins(pluginsDir: string, settingsPaths: string[]): PluginRoot[]`
  - `PluginRoot`（`{ name: string; commandsDirs: string[]; skillsDirs: string[] }`）
  - `scanPlugins(roots: PluginRoot[], ctx: ScanContext): SlashCommandInfo[]`

`installed_plugins.json` の形（実物で確認済み）:

```json
{
  "version": 2,
  "plugins": {
    "code-review@claude-code-plugins": [
      { "scope": "user", "installPath": "/Users/x/.claude/plugins/cache/claude-code-plugins/code-review/1.0.0", "version": "1.0.0" }
    ]
  }
}
```

設定の `enabledPlugins` の形（実物で確認済み）:

```json
{ "enabledPlugins": { "code-review@claude-code-plugins": true } }
```

- [ ] **Step 1: Write the failing test**

`packages/desktop/src/main/__tests__/slash-command-scanner.test.ts` の末尾に追加する:

```typescript
import { resolveEnabledPlugins, scanPlugins } from '../slash-command-scanner'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: FAIL（`resolveEnabledPlugins` が export されていない）

- [ ] **Step 3: Write minimal implementation**

`packages/desktop/src/main/slash-command-scanner.ts` に追加する（`readFileSync` を fs の import に足す）:

```typescript
/** 有効なプラグイン1件の走査対象 */
export interface PluginRoot {
  /** plugin.json の name。呼び出し名の名前空間になる */
  name: string
  commandsDirs: string[]
  skillsDirs: string[]
}

/** JSON ファイルを読む。存在しない・壊れている場合は null */
function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 設定ファイル群の enabledPlugins をマージする。
 * settingsPaths は優先度の低い順に渡す（後ろが前を上書きする）。
 */
function mergeEnabledPlugins(settingsPaths: string[]): Record<string, boolean> {
  const merged: Record<string, boolean> = {}
  for (const path of settingsPaths) {
    const json = readJson(path) as { enabledPlugins?: Record<string, boolean> } | null
    if (!json || typeof json.enabledPlugins !== 'object' || json.enabledPlugins === null) continue
    for (const [key, value] of Object.entries(json.enabledPlugins)) {
      if (typeof value === 'boolean') merged[key] = value
    }
  }
  return merged
}

/** manifest のパス指定を絶対パスの配列にする。未指定なら defaultDir を使う */
function resolveManifestDirs(
  installPath: string,
  value: unknown,
  defaultDir: string,
): string[] {
  const raw = value === undefined ? [defaultDir] : Array.isArray(value) ? value : [value]
  const dirs: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    // './skills/' のような相対指定を installPath 基準で解決する
    const normalized = entry.replace(/^\.\//, '').replace(/\/+$/, '')
    if (!normalized || normalized.startsWith('/') || normalized.includes('..')) continue
    dirs.push(join(installPath, normalized))
  }
  return dirs
}

/**
 * installed_plugins.json と設定の enabledPlugins から、有効なプラグインを解決する。
 *
 * installPath はシンボリックリンクを解決する前の文字列で pluginsDir 配下かを検証する。
 * リンク先が pluginsDir の外でも走査は許すが、読むのは .md / SKILL.md だけに限る。
 */
export function resolveEnabledPlugins(pluginsDir: string, settingsPaths: string[]): PluginRoot[] {
  const installed = readJson(join(pluginsDir, 'installed_plugins.json')) as
    | { plugins?: Record<string, Array<{ installPath?: unknown }>> }
    | null
  if (!installed || typeof installed.plugins !== 'object' || installed.plugins === null) return []

  const enabled = mergeEnabledPlugins(settingsPaths)
  const roots: PluginRoot[] = []

  for (const [key, records] of Object.entries(installed.plugins)) {
    if (enabled[key] !== true) continue
    if (!Array.isArray(records)) continue

    for (const record of records) {
      const installPath = record?.installPath
      if (typeof installPath !== 'string') continue
      if (!installPath.startsWith('/')) continue
      // リンク解決前の文字列で pluginsDir 配下かを判定する
      if (!installPath.startsWith(pluginsDir + '/')) continue

      const manifest = readJson(join(installPath, '.claude-plugin', 'plugin.json')) as
        | { name?: unknown; commands?: unknown; skills?: unknown }
        | null
      if (!manifest || typeof manifest.name !== 'string' || !manifest.name) continue

      roots.push({
        name: manifest.name,
        commandsDirs: resolveManifestDirs(installPath, manifest.commands, 'commands'),
        skillsDirs: resolveManifestDirs(installPath, manifest.skills, 'skills'),
      })
      // 同一プラグインの複数レコードは最初の1件だけ採用する
      break
    }
  }
  return roots
}

/** 有効なプラグインのコマンドとスキルを走査する */
export function scanPlugins(roots: PluginRoot[], ctx: ScanContext): SlashCommandInfo[] {
  const results: SlashCommandInfo[] = []
  for (const root of roots) {
    for (const dir of root.commandsDirs) {
      for (const cmd of scanCommandsDir(dir, 'user', ctx)) {
        results.push({
          name: `${root.name}:${cmd.name}`,
          ...(cmd.description ? { description: cmd.description } : {}),
          scope: 'plugin',
          pluginName: root.name,
        })
      }
    }
    for (const dir of root.skillsDirs) {
      results.push(...scanSkillsDir(dir, 'plugin', ctx, root.name))
    }
  }
  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: PASS（合計 38 件）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/slash-command-scanner.ts packages/desktop/src/main/__tests__/slash-command-scanner.test.ts
git commit -m "feat: 有効なプラグインのコマンド/スキル走査を追加"
```

---

### Task 4: getSlashCommands（統合・組み込み・重複解決・キャッシュ）

走査を1つの入口にまとめ、組み込みコマンドの追加、重複解決、projectPath 検証、キャッシュを行う。

**Files:**
- Modify: `packages/desktop/src/main/slash-command-scanner.ts`
- Test: `packages/desktop/src/main/__tests__/slash-command-scanner.test.ts`

**Interfaces:**
- Consumes: `scanCommandsDir`, `scanSkillsDir`, `resolveEnabledPlugins`, `scanPlugins`, `createScanContext`
- Produces:
  - `getSlashCommands(source: SessionSource | undefined): { commands: SlashCommandInfo[]; truncated: boolean }`
  - `clearSlashCommandCache(): void`（テスト用）
  - `BUILTIN_COMMANDS: SlashCommandInfo[]`

- [ ] **Step 1: Write the failing test**

`packages/desktop/src/main/__tests__/slash-command-scanner.test.ts` の末尾に追加する:

```typescript
import { getSlashCommands, clearSlashCommandCache, BUILTIN_COMMANDS } from '../slash-command-scanner'

describe('getSlashCommands', () => {
  beforeEach(() => {
    clearSlashCommandCache()
  })

  it('claude 以外のセッションでは空配列を返す', () => {
    expect(getSlashCommands({ kind: 'shell' }).commands).toEqual([])
    expect(getSlashCommands({ kind: 'tmux', sessionName: 's' }).commands).toEqual([])
  })

  it('source が undefined のとき空配列を返す', () => {
    expect(getSlashCommands(undefined).commands).toEqual([])
  })

  it('claude セッションでは組み込みコマンドを含む', () => {
    const { commands } = getSlashCommands({ kind: 'claude' })
    expect(commands.some((c) => c.name === 'clear' && c.scope === 'builtin')).toBe(true)
  })

  it('組み込みコマンドの名前に先頭の / を含まない', () => {
    expect(BUILTIN_COMMANDS.every((c) => !c.name.startsWith('/'))).toBe(true)
  })

  it('projectPath が相対パスのとき project スコープを走査しない', () => {
    const { commands } = getSlashCommands({ kind: 'claude', projectPath: 'relative/path' })
    expect(commands.some((c) => c.scope === 'project')).toBe(false)
  })

  it('projectPath が存在しないディレクトリのとき project スコープを走査しない', () => {
    const { commands } = getSlashCommands({ kind: 'claude', projectPath: '/nonexistent/dir/xyz' })
    expect(commands.some((c) => c.scope === 'project')).toBe(false)
  })

  it('同じ projectPath の2回目の呼び出しがキャッシュを返す', () => {
    const first = getSlashCommands({ kind: 'claude' })
    const second = getSlashCommands({ kind: 'claude' })
    expect(second.commands).toBe(first.commands)
  })

  it('projectPath ごとにキャッシュが分かれる', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'scanner-cache-'))
    try {
      mkdirSync(join(tmp, '.claude', 'commands'), { recursive: true })
      writeFileSync(
        join(tmp, '.claude', 'commands', 'only-here.md'),
        '---\ndescription: d\n---\n',
        'utf-8',
      )
      const withPath = getSlashCommands({ kind: 'claude', projectPath: tmp })
      const withoutPath = getSlashCommands({ kind: 'claude' })
      expect(withPath.commands.some((c) => c.name === 'only-here')).toBe(true)
      expect(withoutPath.commands.some((c) => c.name === 'only-here')).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('同名は project > user > plugin > builtin の順に1件へ正規化する', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'scanner-dup-'))
    try {
      mkdirSync(join(tmp, '.claude', 'commands'), { recursive: true })
      // 組み込みの clear と同名のプロジェクトコマンドを置く
      writeFileSync(
        join(tmp, '.claude', 'commands', 'clear.md'),
        '---\ndescription: project version\n---\n',
        'utf-8',
      )
      const { commands } = getSlashCommands({ kind: 'claude', projectPath: tmp })
      const matched = commands.filter((c) => c.name === 'clear')
      expect(matched.length).toBe(1)
      expect(matched[0].scope).toBe('project')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('名前順にソートして返す', () => {
    const { commands } = getSlashCommands({ kind: 'claude' })
    const names = commands.map((c) => c.name)
    expect(names).toEqual([...names].sort())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: FAIL（`getSlashCommands` が export されていない）

- [ ] **Step 3: Write minimal implementation**

`packages/desktop/src/main/slash-command-scanner.ts` に追加する（`homedir` を `os` から import する）:

```typescript
/**
 * Claude Code の組み込みスラッシュコマンド。
 *
 * Claude Code のバージョンアップで内容が変わる。実装時および保守時は
 * `/help` の出力と突き合わせ、存在しないものを削り、足りないものを足すこと。
 */
export const BUILTIN_COMMANDS: SlashCommandInfo[] = [
  { name: 'clear', description: 'Clear conversation history', scope: 'builtin' },
  { name: 'compact', description: 'Compact conversation history', scope: 'builtin' },
  { name: 'resume', description: 'Resume a previous conversation', scope: 'builtin' },
  { name: 'init', description: 'Initialize CLAUDE.md for the project', scope: 'builtin' },
  { name: 'review', description: 'Review a pull request', scope: 'builtin' },
  { name: 'model', description: 'Change the active model', scope: 'builtin' },
  { name: 'status', description: 'Show session status', scope: 'builtin' },
  { name: 'memory', description: 'Edit memory files', scope: 'builtin' },
  { name: 'permissions', description: 'Manage tool permissions', scope: 'builtin' },
  { name: 'config', description: 'Open settings', scope: 'builtin' },
  { name: 'cost', description: 'Show token usage and cost', scope: 'builtin' },
  { name: 'agents', description: 'Manage subagents', scope: 'builtin' },
  { name: 'mcp', description: 'Manage MCP servers', scope: 'builtin' },
  { name: 'add-dir', description: 'Add a working directory', scope: 'builtin' },
  { name: 'help', description: 'Show available commands', scope: 'builtin' },
]

/** scope の優先順位。数値が小さいほど優先する */
const SCOPE_PRIORITY: Record<SlashCommandInfo['scope'], number> = {
  project: 0,
  user: 1,
  plugin: 2,
  builtin: 3,
}

/** getSlashCommands のキャッシュ（30秒TTL）。projectPath ごとに分ける */
const commandsCache = new Map<
  string,
  { value: { commands: SlashCommandInfo[]; truncated: boolean }; expiry: number }
>()

const CACHE_TTL_MS = 30000

/** テスト用にキャッシュを破棄する */
export function clearSlashCommandCache(): void {
  commandsCache.clear()
}

/** projectPath が走査してよい値か検証する。絶対パスかつ実在するディレクトリのみ許す */
function validProjectPath(projectPath: unknown): string | null {
  if (typeof projectPath !== 'string' || !projectPath.startsWith('/')) return null
  try {
    if (!statSync(projectPath).isDirectory()) return null
  } catch {
    return null
  }
  return projectPath
}

/**
 * セッションの起動元に応じたスラッシュコマンド一覧を返す。
 *
 * Codex など別ツールに対応する場合は、この switch に case を足す。
 */
export function getSlashCommands(source: SessionSource | undefined): {
  commands: SlashCommandInfo[]
  truncated: boolean
} {
  switch (source?.kind) {
    case 'claude':
      break
    default:
      return { commands: [], truncated: false }
  }

  const projectPath = validProjectPath(source.projectPath)
  const cacheKey = projectPath ?? '<none>'
  const now = Date.now()
  const cached = commandsCache.get(cacheKey)
  if (cached && now < cached.expiry) return cached.value

  const ctx = createScanContext()
  const home = homedir()
  const claudeDir = join(home, '.claude')

  const collected: SlashCommandInfo[] = [
    ...scanCommandsDir(join(claudeDir, 'commands'), 'user', ctx),
    ...scanSkillsDir(join(claudeDir, 'skills'), 'user', ctx),
    ...scanPlugins(
      resolveEnabledPlugins(join(claudeDir, 'plugins'), [
        join(claudeDir, 'settings.json'),
        ...(projectPath
          ? [
              join(projectPath, '.claude', 'settings.json'),
              join(projectPath, '.claude', 'settings.local.json'),
            ]
          : []),
      ]),
      ctx,
    ),
    ...BUILTIN_COMMANDS,
  ]

  if (projectPath) {
    collected.unshift(
      ...scanCommandsDir(join(projectPath, '.claude', 'commands'), 'project', ctx),
      ...scanSkillsDir(join(projectPath, '.claude', 'skills'), 'project', ctx),
    )
  }

  // 同名は scope の優先順位で1件に正規化する
  const byName = new Map<string, SlashCommandInfo>()
  for (const cmd of collected) {
    const existing = byName.get(cmd.name)
    if (!existing || SCOPE_PRIORITY[cmd.scope] < SCOPE_PRIORITY[existing.scope]) {
      byName.set(cmd.name, cmd)
    }
  }

  const value = {
    commands: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    truncated: ctx.truncated,
  }
  commandsCache.set(cacheKey, { value, expiry: now + CACHE_TTL_MS })
  return value
}
```

`SessionSource` を `@remocoder/shared` の import に足すこと。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @remocoder/desktop test -- slash-command-scanner`
Expected: PASS（合計 48 件）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/slash-command-scanner.ts packages/desktop/src/main/__tests__/slash-command-scanner.test.ts
git commit -m "feat: getSlashCommands で走査を統合しキャッシュと重複解決を追加"
```

---

### Task 5: WebSocket メッセージとサーバーハンドラ

`command_list_request` を受けて `command_list` を返す。

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/desktop/src/main/pty-server.ts`（`session_list_request` ハンドラの直前、`:873` 付近）
- Test: `packages/desktop/src/main/__tests__/pty-server.test.ts`

**Interfaces:**
- Consumes: `getSlashCommands(source: SessionSource | undefined): { commands: SlashCommandInfo[]; truncated: boolean }`
- Produces: WsMessage の `command_list_request` と `command_list`

- [ ] **Step 1: shared に WsMessage を追加**

`packages/shared/src/types.ts` の `WsMessage` に、`session_delete` の定義の直前へ追加する:

```typescript
  /** モバイルがスラッシュコマンド一覧を要求する */
  | { type: 'command_list_request' }
  /** command_list_request への応答 */
  | {
      type: 'command_list'
      sessionId: string | null
      commands: SlashCommandInfo[]
      truncated?: boolean
      error?: string
    }
```

- [ ] **Step 2: Write the failing test**

`packages/desktop/src/main/__tests__/pty-server.test.ts` の `describe('session_list_request', ...)` の直後に追加する:

```typescript
  describe('command_list_request', () => {
    it('claude セッションにアタッチ済みなら command_list が返る', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      sendMessage(ws, { type: 'command_list_request' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'command_list')
      expect(response).toBeDefined()
      expect(Array.isArray(response.commands)).toBe(true)
      expect(response.sessionId).toBeTruthy()
    })

    it('組み込みコマンドが含まれる', () => {
      const { ws } = connectAuthAndCreate(startPtyServer)
      sendMessage(ws, { type: 'command_list_request' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'command_list')
      expect(response.commands.some((c: any) => c.name === 'clear')).toBe(true)
    })

    it('未アタッチのクライアントには error: not_attached を返す', () => {
      const { ws } = connectAndAuth(startPtyServer)
      sendMessage(ws, { type: 'command_list_request' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'command_list')
      expect(response).toBeDefined()
      expect(response.error).toBe('not_attached')
      expect(response.sessionId).toBeNull()
      expect(response.commands).toEqual([])
    })

    it('shell セッションでは空の一覧を返す', () => {
      startPtyServer()
      const ws = createMockWs()
      wssState.instance!.emit('connection', ws)
      sendMessage(ws, { type: 'auth', token: 'test-token' })
      sendMessage(ws, { type: 'session_create', source: { kind: 'shell' } })
      sendMessage(ws, { type: 'command_list_request' })

      const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
      const response = calls.find((m: any) => m.type === 'command_list')
      expect(response.commands).toEqual([])
      expect(response.sessionId).toBeTruthy()
    })

    it('走査が失敗しても接続を切らず error を返す', async () => {
      const scanner = await import('../slash-command-scanner')
      const spy = vi.spyOn(scanner, 'getSlashCommands').mockImplementation(() => {
        throw new Error('scan failed')
      })
      try {
        const { ws } = connectAuthAndCreate(startPtyServer)
        sendMessage(ws, { type: 'command_list_request' })

        const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
        const response = calls.find((m: any) => m.type === 'command_list')
        expect(response.error).toBe('scan_failed')
        expect(response.commands).toEqual([])
        expect(ws.close).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @remocoder/desktop test -- pty-server`
Expected: FAIL（`command_list` の応答が見つからない）

- [ ] **Step 4: Write minimal implementation**

`packages/desktop/src/main/pty-server.ts` の import に追加する:

```typescript
import { getSlashCommands } from './slash-command-scanner'
```

`if (msg.type === 'session_list_request') {` の直前に追加する:

```typescript
      if (msg.type === 'command_list_request') {
        if (!attachedSessionId) {
          ws.send(
            JSON.stringify({
              type: 'command_list',
              sessionId: null,
              commands: [],
              error: 'not_attached',
            } satisfies WsMessage),
          )
          return
        }

        const session = ptySessions.get(attachedSessionId)
        if (!session) {
          ws.send(
            JSON.stringify({
              type: 'command_list',
              sessionId: null,
              commands: [],
              error: 'not_attached',
            } satisfies WsMessage),
          )
          return
        }

        try {
          // source が保持するのはセッション作成時のプロジェクトパスであり、
          // Claude Code 内で /cd した後の現在の cwd ではない
          const { commands, truncated } = getSlashCommands(session.source)
          ws.send(
            JSON.stringify({
              type: 'command_list',
              sessionId: session.id,
              commands,
              truncated,
            } satisfies WsMessage),
          )
        } catch (err) {
          console.error('[pty-server] スラッシュコマンドの走査に失敗しました:', err)
          ws.send(
            JSON.stringify({
              type: 'command_list',
              sessionId: session.id,
              commands: [],
              error: 'scan_failed',
            } satisfies WsMessage),
          )
        }
        return
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @remocoder/desktop test -- pty-server`
Expected: PASS（新規 5 件を含む）

- [ ] **Step 6: Run the whole desktop suite**

Run: `pnpm --filter @remocoder/desktop test`
Expected: PASS（既存テストの退行なし）

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/desktop/src/main/pty-server.ts packages/desktop/src/main/__tests__/pty-server.test.ts
git commit -m "feat: command_list_request ハンドラを追加"
```

---

### Task 6: WebView のブリッジと session_attached の source 転送

WebView 側に一覧取得のブリッジ関数を足し、`session_attached` の native 転送に `source` を含める。

**Files:**
- Modify: `packages/mobile/src/assets/terminalHtml.ts`（`:257` 付近と `:377` 付近）
- Test: `packages/mobile/src/__tests__/terminal.html.test.ts`

**Interfaces:**
- Consumes: WsMessage の `command_list_request` / `command_list`
- Produces:
  - `window.requestCommandList(): void`（WebView 内のグローバル関数）
  - native への postMessage: `{ type: 'command_list', commands, truncated, sessionId, error }`
  - native への postMessage: `{ type: 'session_attached', sessionId, source }`

- [ ] **Step 1: Write the failing test**

`packages/mobile/src/__tests__/terminal.html.test.ts` の末尾（最後の `})` の直前）に追加する:

```typescript
  describe('スラッシュコマンド一覧', () => {
    const html = buildTerminalHtml('ws://100.64.0.1:8080', 'tok')

    it('requestCommandList ブリッジ関数が定義されている', () => {
      expect(html).toContain('window.requestCommandList')
    })

    it('command_list_request を送信する', () => {
      expect(html).toContain("type: 'command_list_request'")
    })

    it('command_list メッセージを native に転送する', () => {
      expect(html).toContain("msg.type === 'command_list'")
    })

    it('session_attached の native 転送に source を含める', () => {
      expect(html).toMatch(/type: 'session_attached', sessionId: msg\.sessionId, source: msg\.source/)
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @remocoder/mobile test -- terminal.html`
Expected: FAIL（4件）

- [ ] **Step 3: Write minimal implementation**

`packages/mobile/src/assets/terminalHtml.ts` の `:257` の行を置き換える:

```javascript
          postToNative({ type: 'session_attached', sessionId: msg.sessionId, source: msg.source })
```

`} else if (msg.type === 'session_not_found') {` の直前に分岐を追加する:

```javascript
        } else if (msg.type === 'command_list') {
          postToNative({
            type: 'command_list',
            sessionId: msg.sessionId,
            commands: msg.commands,
            truncated: msg.truncated,
            error: msg.error,
          })
```

`window.sendInput` の定義の直前にブリッジ関数を追加する:

```javascript
    /** スラッシュコマンド一覧をサーバーに要求する */
    window.requestCommandList = function() {
      sendWs({ type: 'command_list_request' })
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @remocoder/mobile test -- terminal.html`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/src/assets/terminalHtml.ts packages/mobile/src/__tests__/terminal.html.test.ts
git commit -m "feat: WebView にコマンド一覧ブリッジを追加し session_attached に source を含める"
```

---

### Task 7: SlashCommandSheet コンポーネント

検索付きのコマンド一覧シート。使用回数の読み書きも持つ。

**Files:**
- Create: `packages/mobile/src/components/SlashCommandSheet.tsx`
- Test: `packages/mobile/src/components/__tests__/SlashCommandSheet.test.tsx`

**Interfaces:**
- Consumes: `SlashCommandInfo`（shared）
- Produces:
  - `SlashCommandSheet` コンポーネント。props は
    `{ visible: boolean; commands: SlashCommandInfo[]; truncated?: boolean; onClose: () => void; onSelect: (name: string) => void }`
  - `USAGE_STORAGE_KEY = 'slashCommandUsage'`
  - `loadUsage(): Promise<Record<string, number>>`
  - `recordUsage(name: string): Promise<void>`
  - `sortCommands(commands: SlashCommandInfo[], usage: Record<string, number>): SlashCommandInfo[]`

- [ ] **Step 1: Write the failing test**

`packages/mobile/src/components/__tests__/SlashCommandSheet.test.tsx`:

```typescript
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SlashCommandInfo } from '@remocoder/shared'
import {
  SlashCommandSheet,
  sortCommands,
  loadUsage,
  recordUsage,
  USAGE_STORAGE_KEY,
} from '../SlashCommandSheet'

const makeCommand = (overrides: Partial<SlashCommandInfo> = {}): SlashCommandInfo => ({
  name: 'commit',
  description: 'Create a git commit',
  scope: 'user',
  ...overrides,
})

const defaultProps = {
  visible: true,
  commands: [makeCommand()],
  onClose: jest.fn(),
  onSelect: jest.fn(),
}

describe('sortCommands', () => {
  it('使用回数の多い順に並べる', () => {
    const commands = [
      makeCommand({ name: 'a' }),
      makeCommand({ name: 'b' }),
      makeCommand({ name: 'c' }),
    ]
    const sorted = sortCommands(commands, { b: 5, c: 2 })
    expect(sorted.map((c) => c.name)).toEqual(['b', 'c', 'a'])
  })

  it('使用回数が同じなら名前順に並べる', () => {
    const commands = [makeCommand({ name: 'z' }), makeCommand({ name: 'a' })]
    expect(sortCommands(commands, { z: 1, a: 1 }).map((c) => c.name)).toEqual(['a', 'z'])
  })

  it('未使用のコマンドを名前順で後方に置く', () => {
    const commands = [
      makeCommand({ name: 'unused-a' }),
      makeCommand({ name: 'used' }),
      makeCommand({ name: 'unused-b' }),
    ]
    expect(sortCommands(commands, { used: 1 }).map((c) => c.name)).toEqual([
      'used',
      'unused-a',
      'unused-b',
    ])
  })

  it('元の配列を破壊しない', () => {
    const commands = [makeCommand({ name: 'b' }), makeCommand({ name: 'a' })]
    sortCommands(commands, {})
    expect(commands.map((c) => c.name)).toEqual(['b', 'a'])
  })
})

describe('使用回数の永続化', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await AsyncStorage.clear()
  })

  it('recordUsage が回数を1増やす', async () => {
    await recordUsage('commit')
    await recordUsage('commit')
    expect(await loadUsage()).toEqual({ commit: 2 })
  })

  it('loadUsage は未保存のとき空オブジェクトを返す', async () => {
    expect(await loadUsage()).toEqual({})
  })

  it('loadUsage は壊れた JSON でも空オブジェクトを返す', async () => {
    await AsyncStorage.setItem(USAGE_STORAGE_KEY, '{ broken')
    expect(await loadUsage()).toEqual({})
  })

  it('loadUsage は読み取り失敗時に空オブジェクトを返す', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('fail'))
    expect(await loadUsage()).toEqual({})
    spy.mockRestore()
  })

  it('recordUsage は書き込み失敗時に例外を投げない', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('fail'))
    await expect(recordUsage('commit')).resolves.toBeUndefined()
    spy.mockRestore()
  })
})

describe('SlashCommandSheet', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await AsyncStorage.clear()
  })

  it('visible=false のとき中身を描画しない', () => {
    render(<SlashCommandSheet {...defaultProps} visible={false} />)
    expect(screen.queryByText('Commands')).toBeNull()
  })

  it('visible=true のときタイトルを表示する', () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(screen.getByText('Commands')).toBeTruthy()
  })

  it('コマンド名を先頭の / 付きで表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(await screen.findByText('/commit')).toBeTruthy()
  })

  it('description を表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(await screen.findByText('Create a git commit')).toBeTruthy()
  })

  it('scope を表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(await screen.findByText('user')).toBeTruthy()
  })

  it('コマンド名で絞り込む', async () => {
    const commands = [makeCommand({ name: 'commit' }), makeCommand({ name: 'review' })]
    render(<SlashCommandSheet {...defaultProps} commands={commands} />)
    fireEvent.changeText(screen.getByPlaceholderText('Search…'), 'rev')
    await waitFor(() => expect(screen.queryByText('/commit')).toBeNull())
    expect(screen.getByText('/review')).toBeTruthy()
  })

  it('description で絞り込む', async () => {
    const commands = [
      makeCommand({ name: 'a', description: 'git commit helper' }),
      makeCommand({ name: 'b', description: 'unrelated' }),
    ]
    render(<SlashCommandSheet {...defaultProps} commands={commands} />)
    fireEvent.changeText(screen.getByPlaceholderText('Search…'), 'git')
    await waitFor(() => expect(screen.queryByText('/b')).toBeNull())
    expect(screen.getByText('/a')).toBeTruthy()
  })

  it('大文字小文字を区別せず絞り込む', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    fireEvent.changeText(screen.getByPlaceholderText('Search…'), 'COMMIT')
    expect(await screen.findByText('/commit')).toBeTruthy()
  })

  it('コマンドを押すと onSelect が名前で呼ばれる', async () => {
    const onSelect = jest.fn()
    render(<SlashCommandSheet {...defaultProps} onSelect={onSelect} />)
    fireEvent.press(await screen.findByText('/commit'))
    expect(onSelect).toHaveBeenCalledWith('commit')
  })

  it('コマンドを押すと使用回数が記録される', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    fireEvent.press(await screen.findByText('/commit'))
    await waitFor(async () => expect(await loadUsage()).toEqual({ commit: 1 }))
  })

  it('閉じるボタンで onClose が呼ばれる', () => {
    const onClose = jest.fn()
    render(<SlashCommandSheet {...defaultProps} onClose={onClose} />)
    fireEvent.press(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalled()
  })

  it('truncated のとき打ち切りの注記を表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} truncated />)
    expect(await screen.findByText(/truncated/i)).toBeTruthy()
  })

  it('コマンドが空のとき空状態を表示する', () => {
    render(<SlashCommandSheet {...defaultProps} commands={[]} />)
    expect(screen.getByText('No commands found')).toBeTruthy()
  })

  it('保存済みの使用回数の順に並べて表示する', async () => {
    await AsyncStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ review: 3 }))
    const commands = [makeCommand({ name: 'commit' }), makeCommand({ name: 'review' })]
    render(<SlashCommandSheet {...defaultProps} commands={commands} />)
    const items = await screen.findAllByText(/^\//)
    expect(items[0].props.children).toBe('/review')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @remocoder/mobile test -- SlashCommandSheet`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: Write minimal implementation**

`packages/mobile/src/components/SlashCommandSheet.tsx`:

```typescript
import React, { useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SlashCommandInfo } from '@remocoder/shared'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'

export const USAGE_STORAGE_KEY = 'slashCommandUsage'

interface Props {
  visible: boolean
  commands: SlashCommandInfo[]
  truncated?: boolean
  onClose: () => void
  onSelect: (name: string) => void
}

/** 保存済みの使用回数を読む。失敗時は空オブジェクトを返す */
export async function loadUsage(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Record<string, number>
  } catch {
    return {}
  }
}

/** 使用回数を1増やす。失敗しても例外にしない */
export async function recordUsage(name: string): Promise<void> {
  try {
    const usage = await loadUsage()
    usage[name] = (usage[name] ?? 0) + 1
    await AsyncStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage))
  } catch {
    // 使用回数は補助情報なので、保存に失敗しても操作は続行する
  }
}

/** 使用回数の降順 → 名前の昇順で並べる。元の配列は変更しない */
export function sortCommands(
  commands: SlashCommandInfo[],
  usage: Record<string, number>,
): SlashCommandInfo[] {
  return [...commands].sort((a, b) => {
    const diff = (usage[b.name] ?? 0) - (usage[a.name] ?? 0)
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name)
  })
}

export function SlashCommandSheet({ visible, commands, truncated, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<Record<string, number>>({})
  const keyboardHeight = useKeyboardHeight()

  useEffect(() => {
    if (!visible) return
    setQuery('')
    loadUsage().then(setUsage)
  }, [visible])

  const visibleCommands = useMemo(() => {
    const sorted = sortCommands(commands, usage)
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
    )
  }, [commands, usage, query])

  function handleSelect(name: string) {
    onSelect(name)
    recordUsage(name).then(() => loadUsage().then(setUsage))
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { paddingBottom: keyboardHeight }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Commands</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            placeholderTextColor="#6a6a6a"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {visibleCommands.length === 0 ? (
            <Text style={styles.empty}>No commands found</Text>
          ) : (
            <FlatList
              data={visibleCommands}
              keyExtractor={(item) => item.name}
              keyboardShouldPersistTaps="always"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => handleSelect(item.name)}
                  activeOpacity={0.6}
                >
                  <View style={styles.rowTop}>
                    <Text style={styles.name}>{`/${item.name}`}</Text>
                    <Text style={styles.scope}>{item.scope}</Text>
                    {usage[item.name] ? (
                      <Text style={styles.count}>{usage[item.name]}</Text>
                    ) : null}
                  </View>
                  {item.description ? (
                    <Text style={styles.description} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              )}
            />
          )}

          {truncated && (
            <Text style={styles.note}>List truncated: too many command files to scan.</Text>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  container: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '80%',
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  title: { color: '#d4d4d4', fontSize: 16, fontWeight: '600' },
  closeBtn: { padding: 4 },
  closeText: { color: '#d4d4d4', fontSize: 16 },
  search: {
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    color: '#d4d4d4',
    fontSize: 14,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: '#569cd6', fontSize: 14, fontFamily: 'Menlo', flexShrink: 1 },
  scope: { color: '#6a6a6a', fontSize: 11 },
  count: { color: '#4ec9b0', fontSize: 11, marginLeft: 'auto' },
  description: { color: '#9a9a9a', fontSize: 12, marginTop: 2 },
  empty: { color: '#6a6a6a', fontSize: 13, textAlign: 'center', padding: 24 },
  note: { color: '#dcdcaa', fontSize: 11, paddingHorizontal: 16, paddingTop: 8 },
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @remocoder/mobile test -- SlashCommandSheet`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/src/components/SlashCommandSheet.tsx packages/mobile/src/components/__tests__/SlashCommandSheet.test.tsx
git commit -m "feat: スラッシュコマンド選択シートを追加"
```

---

### Task 8: ツールバーと画面の結線

`/` ボタンを足し、`TerminalScreen` でシートと入力挿入をつなぐ。

**Files:**
- Modify: `packages/mobile/src/components/KeyboardToolbar.tsx`
- Modify: `packages/mobile/src/screens/TerminalScreen.tsx`
- Test: `packages/mobile/src/screens/__tests__/TerminalScreen.test.tsx`

**Interfaces:**
- Consumes: `SlashCommandSheet`、`window.requestCommandList`、`window.sendInput`
- Produces: なし（最終結線）

- [ ] **Step 1: Write the failing test**

`packages/mobile/src/screens/__tests__/TerminalScreen.test.tsx` の末尾（最後の `})` の直前）に追加する。既存ファイルのヘルパー（WebView モックと `useLocalSearchParams` のモック）に合わせること:

```typescript
  describe('スラッシュコマンドシート', () => {
    it('claude セッションでは / ボタンを表示する', async () => {
      render(<TerminalScreen />)
      emitWebViewMessage({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      expect(await screen.findByText('/')).toBeTruthy()
    })

    it('shell セッションでは / ボタンを表示しない', async () => {
      render(<TerminalScreen />)
      emitWebViewMessage({ type: 'session_attached', sessionId: 's1', source: { kind: 'shell' } })
      await waitFor(() => expect(screen.queryByText('/')).toBeNull())
    })

    it('session_attached を受けると requestCommandList を注入する', async () => {
      render(<TerminalScreen />)
      emitWebViewMessage({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      await waitFor(() =>
        expect(injectedScripts.some((s) => s.includes('requestCommandList'))).toBe(true),
      )
    })

    it('command_list を受け取るとシートに反映する', async () => {
      render(<TerminalScreen />)
      emitWebViewMessage({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      emitWebViewMessage({
        type: 'command_list',
        sessionId: 's1',
        commands: [{ name: 'commit', description: 'Create a git commit', scope: 'user' }],
      })
      fireEvent.press(await screen.findByText('/'))
      expect(await screen.findByText('/commit')).toBeTruthy()
    })

    it('コマンドを選ぶと sendInput を注入してシートを閉じる', async () => {
      render(<TerminalScreen />)
      emitWebViewMessage({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      emitWebViewMessage({
        type: 'command_list',
        sessionId: 's1',
        commands: [{ name: 'commit', scope: 'user' }],
      })
      fireEvent.press(await screen.findByText('/'))
      fireEvent.press(await screen.findByText('/commit'))

      await waitFor(() =>
        expect(injectedScripts.some((s) => s.includes('sendInput("/commit")'))).toBe(true),
      )
      await waitFor(() => expect(screen.queryByText('Commands')).toBeNull())
    })
  })
```

既存ファイルに `emitWebViewMessage` / `injectedScripts` のヘルパーがない場合は、既存の WebView モックの `onMessage` 呼び出しと `injectJavaScript` の記録を追加してから使うこと。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @remocoder/mobile test -- TerminalScreen`
Expected: FAIL

- [ ] **Step 3: KeyboardToolbar に `/` ボタンを追加**

`packages/mobile/src/components/KeyboardToolbar.tsx` の Props とコンポーネント冒頭を変更する:

```typescript
import { SessionSource } from '@remocoder/shared'

interface Props {
  webViewRef: React.RefObject<WebView | null>
  /** 現在のセッションの起動元。claude のときだけコマンドボタンを出す */
  source?: SessionSource | null
  onOpenCommands?: () => void
}

export function KeyboardToolbar({ webViewRef, source, onOpenCommands }: Props) {
```

CTRL トグルの `</TouchableOpacity>` の直後に追加する:

```typescript
      {/* スラッシュコマンドボタン（claude セッションのみ） */}
      {source?.kind === 'claude' && onOpenCommands && (
        <TouchableOpacity
          style={styles.ctrlToggle}
          onPress={onOpenCommands}
          activeOpacity={0.7}
        >
          <Text style={styles.keyText}>/</Text>
        </TouchableOpacity>
      )}
```

- [ ] **Step 4: TerminalScreen を結線**

`packages/mobile/src/screens/TerminalScreen.tsx` に追加する。

import に足す:

```typescript
import { DEFAULT_WS_PORT, SessionSource, SlashCommandInfo } from '@remocoder/shared'
import { SlashCommandSheet } from '../components/SlashCommandSheet'
```

`webViewRef` の宣言の下に state を足す:

```typescript
  const [currentSource, setCurrentSource] = useState<SessionSource | null>(null)
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  const [commandsTruncated, setCommandsTruncated] = useState(false)
  const [sheetVisible, setSheetVisible] = useState(false)
```

URL パラメータの `source` を初期値にする（`source` useMemo の下）:

```typescript
  useEffect(() => {
    if (source) setCurrentSource(source)
  }, [source])
```

`handleMessage` の `case 'session_attached':` を差し替える:

```typescript
        case 'session_attached':
          setStatus('connected')
          setPendingPermission(null)
          if (msg.source) setCurrentSource(msg.source as SessionSource)
          // セッションが変わるとプロジェクトも変わるので一覧を取り直す
          webViewRef.current?.injectJavaScript('window.requestCommandList(); true;')
          break
```

`case 'permission_request':` の直前に追加する:

```typescript
        case 'command_list':
          setCommands((msg.commands as SlashCommandInfo[]) ?? [])
          setCommandsTruncated(Boolean(msg.truncated))
          break
```

選択ハンドラを `handleRetry` の下に追加する:

```typescript
  const handleSelectCommand = useCallback((name: string) => {
    setSheetVisible(false)
    webViewRef.current?.injectJavaScript(
      `window.sendInput(${JSON.stringify(`/${name}`)}); true;`,
    )
  }, [])
```

`KeyboardToolbar` の呼び出しを差し替え、シートを追加する:

```typescript
      <KeyboardToolbar
        webViewRef={webViewRef}
        source={currentSource}
        onOpenCommands={() => setSheetVisible(true)}
      />

      <SlashCommandSheet
        visible={sheetVisible}
        commands={commands}
        truncated={commandsTruncated}
        onClose={() => setSheetVisible(false)}
        onSelect={handleSelectCommand}
      />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @remocoder/mobile test -- TerminalScreen`
Expected: PASS

- [ ] **Step 6: Run the whole suite**

Run: `pnpm test`
Expected: PASS（desktop・mobile・shared すべて退行なし）

- [ ] **Step 7: Commit**

```bash
git add packages/mobile/src/components/KeyboardToolbar.tsx packages/mobile/src/screens/TerminalScreen.tsx packages/mobile/src/screens/__tests__/TerminalScreen.test.tsx
git commit -m "feat: ツールバーの / ボタンとコマンドシートを結線"
```

---

### Task 9: 実機確認

仕様書の「実装前に検証する項目」を実機で確認し、必要なら挿入文字列を調整する。

**Files:**
- Modify（必要な場合のみ）: `packages/mobile/src/screens/TerminalScreen.tsx`
- Modify（必要な場合のみ）: `packages/desktop/src/main/slash-command-scanner.ts`

**Interfaces:**
- Consumes: Task 8 までの全機能
- Produces: なし

- [ ] **Step 1: デスクトップとモバイルを起動する**

```bash
pnpm dev
```

別ターミナルで:

```bash
pnpm mobile
```

- [ ] **Step 2: 挿入文字列の挙動を確認する**

claude セッションに接続し、`/` ボタンからシートを開き、`/commit` のような引数を取らないコマンドを選ぶ。

確認すること:
- Claude Code の候補メニューがどう表示されるか
- そのまま Enter を押したときに、選んだコマンドがそのまま実行されるか、別の候補が確定されるか

`/co` のような前置一致でハイライト行が別のコマンドになる場合は、`TerminalScreen.tsx` の `handleSelectCommand` の挿入文字列を `/${name} `（末尾スペースあり）に変え、同じ手順で再確認する。期待どおりになる方を採用する。

- [ ] **Step 3: 複数文字入力がペースト扱いにならないか確認する**

コマンド挿入後、入力欄の表示が1文字ずつ打った場合と同じか確認する。ペースト扱いで折りたたみ表示（`[Pasted text]` のような表示）になる場合は、`terminalHtml.ts` の `window.sendInput` を1文字ずつ送るループに変える。

- [ ] **Step 4: 組み込みコマンドを `/help` と突き合わせる**

Claude Code で `/help` を実行し、`BUILTIN_COMMANDS` に存在しないコマンドが含まれていないか、日常的に使うものが漏れていないかを確認する。差分があれば `slash-command-scanner.ts` の `BUILTIN_COMMANDS` を修正し、テストを更新する。

- [ ] **Step 5: 変更があればコミット**

```bash
git add -A
git commit -m "fix: 実機確認の結果を反映"
```

---

## Self-Review

**1. Spec coverage**

| 仕様書のセクション | 対応タスク |
|---|---|
| 走査対象と呼び出し名 | Task 2（commands / skills）、Task 3（plugin）、Task 4（builtin） |
| サブディレクトリを呼び出し名に含めない | Task 2 |
| プラグインの解決（enabledPlugins、manifest） | Task 3 |
| 除外規則（user-invocable） | Task 2 |
| description の切り詰め | Task 2 |
| 名前の重複解決 | Task 4 |
| 走査の安全性と上限 | Task 2（深度・件数・時間・循環）、Task 3（installPath 検証）、Task 4（projectPath 検証） |
| キャッシュ | Task 4 |
| 拡張性（switch） | Task 4 |
| 組み込みコマンドの固定リスト | Task 4、Task 9 Step 4 |
| 通信と型 | Task 2（SlashCommandInfo）、Task 5（WsMessage） |
| 通信の仕様（未アタッチ・失敗・非 claude） | Task 5 |
| terminalHtml のブリッジと source 転送 | Task 6 |
| TerminalScreen の state と取得タイミング | Task 8 |
| SlashCommandSheet | Task 7 |
| KeyboardToolbar の `/` ボタン | Task 8 |
| 使用回数の保存 | Task 7 |
| 実機で検証する項目 | Task 9 |

`skillOverrides` による除外は、この環境の設定に存在せず形式を確認できなかったため実装しない。仕様書に記載があるので、Task 9 の実機確認時に `skillOverrides` を設定している環境があれば追加対応する。

**2. Placeholder scan**

「適切なエラー処理」「必要に応じて」のような指示は使っていない。各ステップに実際のコードがある。Task 8 Step 1 の「既存ヘルパーがない場合は追加する」は、既存テストファイルの内容に依存するため実装者の確認が必要な唯一の箇所。

**3. Type consistency**

- `SlashCommandInfo` は Task 2 で定義し、Task 3・4・5・7・8 で同じ形を使う
- `ScanContext` は Task 2 で定義し、Task 3・4 で使う
- `getSlashCommands(source)` の戻り値 `{ commands, truncated }` は Task 4 で定義し、Task 5 で分解する
- `command_list` の形（`sessionId` / `commands` / `truncated` / `error`）は Task 5 で定義し、Task 6 で転送、Task 8 で消費する
- `SlashCommandSheet` の props（`visible` / `commands` / `truncated` / `onClose` / `onSelect`）は Task 7 で定義し、Task 8 で使う
- `KeyboardToolbar` の新 props（`source` / `onOpenCommands`）は Task 8 で定義と使用が同一タスク内
