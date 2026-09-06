/**
 * Claude Code のスラッシュコマンド（コマンド定義とスキル）を走査して一覧化する。
 *
 * 依存を増やさないため glob ライブラリは使わず Node の fs API のみで実装する。
 */

import {
  readdirSync,
  openSync,
  readSync,
  closeSync,
  realpathSync,
  existsSync,
  statSync,
  readFileSync,
  type Dirent,
} from 'fs'
import { join, basename, normalize, isAbsolute, relative } from 'path'
import { homedir } from 'os'
import { SlashCommandInfo, SessionSource } from '@remocoder/shared'

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

/**
 * 走査の最大深度。root を深さ 0 とし、深さ MAX_DEPTH のディレクトリには入らない。
 * つまり root + 2 階層までを走査する。
 */
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
  scope: 'user' | 'project' | 'plugin',
  ctx: ScanContext,
): SlashCommandInfo[] {
  const results: SlashCommandInfo[] = []

  function walk(dir: string, depth: number, relDir: string) {
    if (depth >= MAX_DEPTH) return
    if (isExhausted(ctx)) return
    if (!enterDirectory(dir, ctx)) return

    let entries: Dirent[]
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

  let entries: Dirent[]
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

/**
 * プラグイン root 直下の SKILL.md（`installPath/SKILL.md`）を走査する。
 *
 * skills/ 配下のスキルと違い、ディレクトリ名から呼び出し名を決められない
 * （root 自体がプラグインの installPath であり、名前を持つ「1階層下」がない）。
 * そのためプラグイン名をそのまま呼び出し名にする（`/<pluginName>`）。
 * ただし SKILL.md の frontmatter に `name` があれば、skills/ 配下のスキルと
 * 同じ命名パターン（`<pluginName>:<name>`）に揃えるためそちらを使う。
 */
export function scanPluginRootSkill(
  installPath: string,
  pluginName: string,
  ctx: ScanContext,
): SlashCommandInfo[] {
  if (isExhausted(ctx)) return []
  const skillFile = join(installPath, 'SKILL.md')
  if (!existsSync(skillFile)) return []

  ctx.fileCount++
  let front: Record<string, string> = {}
  try {
    front = parseFrontmatter(readHead(skillFile))
  } catch {
    return []
  }
  if (front['user-invocable'] === 'false') return []

  const info: SlashCommandInfo = {
    name: front.name ? `${pluginName}:${front.name}` : pluginName,
    scope: 'plugin',
    pluginName,
  }
  const description = truncateDescription(front.description)
  if (description) info.description = description
  return [info]
}

/** 有効なプラグイン1件の走査対象 */
export interface PluginRoot {
  /** plugin.json の name。呼び出し名の名前空間になる */
  name: string
  /** プラグイン本体のディレクトリ。root 直下の SKILL.md を探すために使う */
  installPath: string
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
    // isAbsolute は Windows の 'C:\...' もカバーする（startsWith('/') は POSIX 専用だった）
    if (!normalized || isAbsolute(normalized) || normalized.includes('..')) continue
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
  // normalize はファイルシステムに触れずシンボリックリンクも解決しない純粋な文字列操作なので、
  // 「リンク解決前の文字列で判定する」というルールに反しない
  const normalizedPluginsDir = normalize(pluginsDir)

  for (const [key, records] of Object.entries(installed.plugins)) {
    if (enabled[key] !== true) continue
    if (!Array.isArray(records)) continue

    for (const record of records) {
      const rawInstallPath = record?.installPath
      if (typeof rawInstallPath !== 'string') continue
      // isAbsolute は Windows の 'C:\...' もカバーする（startsWith('/') は POSIX 専用だった）
      if (!isAbsolute(rawInstallPath)) continue
      // '..' を含む文字列がプレフィックス一致だけをすり抜けて pluginsDir の外を指さないよう、
      // 判定にも以降の join にも正規化後のパスを使う
      const installPath = normalize(rawInstallPath)
      // startsWith(normalizedPluginsDir + '/') は Windows では区切りが '\' になり常に false
      // だったため、relative() ベースの包含判定に置き換える。
      // pluginsDir と一致（空文字）・'..' で始まる（配下から出る）・絶対パスが返る
      // （別ドライブなど比較不能）のいずれかなら pluginsDir 配下ではないとみなす。
      const rel = relative(normalizedPluginsDir, installPath)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue

      const manifest = readJson(join(installPath, '.claude-plugin', 'plugin.json')) as
        | { name?: unknown; commands?: unknown; skills?: unknown }
        | null
      if (!manifest || typeof manifest.name !== 'string' || !manifest.name) continue

      roots.push({
        name: manifest.name,
        installPath,
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
      // scope に 'plugin' を渡すことで、サブディレクトリ由来の namespace も
      // 'plugin:<subdir>' として正しく組み立てられる
      for (const cmd of scanCommandsDir(dir, 'plugin', ctx)) {
        // namespace など既存フィールドを落とさないよう先に展開する
        results.push({
          ...cmd,
          name: `${root.name}:${cmd.name}`,
          pluginName: root.name,
        })
      }
    }
    for (const dir of root.skillsDirs) {
      results.push(...scanSkillsDir(dir, 'plugin', ctx, root.name))
    }
    results.push(...scanPluginRootSkill(root.installPath, root.name, ctx))
  }
  return results
}

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

/** getSlashCommands のキャッシュ（30秒TTL）。claudeDir と projectPath の組ごとに分ける */
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
  // isAbsolute は Windows の 'C:\...' もカバーする（startsWith('/') は POSIX 専用だった）
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) return null
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
export function getSlashCommands(
  source: SessionSource | undefined,
  // claudeDir はテストから一時ディレクトリを渡すための引数。本番では省略する
  options: { claudeDir?: string } = {},
): {
  commands: SlashCommandInfo[]
  truncated: boolean
} {
  switch (source?.kind) {
    case 'claude':
      break
    default:
      return { commands: [], truncated: false }
  }

  const claudeDir = options.claudeDir ?? join(homedir(), '.claude')
  const projectPath = validProjectPath(source.projectPath)
  const cacheKey = `${claudeDir}|${projectPath ?? '<none>'}`
  const now = Date.now()
  const cached = commandsCache.get(cacheKey)
  if (cached && now < cached.expiry) return cached.value

  const ctx = createScanContext()

  // 走査の順序は「500ファイル/3秒」の budget を優先度の高いスコープから
  // 消費させるためのものであり、同名の重複解決とは無関係（重複解決は下の
  // SCOPE_PRIORITY テーブルで名前ごとに行うため順序に依存しない）。
  // project を先頭に置かないと、user・plugin の走査だけで budget を使い切った
  // 場合に最優先スコープの project が丸ごと落ちてしまう。
  // 「読みやすさ」のために project スコープをここから動かさないこと。
  const collected: SlashCommandInfo[] = [
    ...(projectPath
      ? [
          ...scanCommandsDir(join(projectPath, '.claude', 'commands'), 'project', ctx),
          ...scanSkillsDir(join(projectPath, '.claude', 'skills'), 'project', ctx),
        ]
      : []),
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
