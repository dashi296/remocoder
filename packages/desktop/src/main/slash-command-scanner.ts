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
import { join, basename, normalize } from 'path'
import { SlashCommandInfo } from '@remocoder/shared'

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
  // normalize はファイルシステムに触れずシンボリックリンクも解決しない純粋な文字列操作なので、
  // 「リンク解決前の文字列で判定する」というルールに反しない
  const normalizedPluginsDir = normalize(pluginsDir)

  for (const [key, records] of Object.entries(installed.plugins)) {
    if (enabled[key] !== true) continue
    if (!Array.isArray(records)) continue

    for (const record of records) {
      const rawInstallPath = record?.installPath
      if (typeof rawInstallPath !== 'string') continue
      if (!rawInstallPath.startsWith('/')) continue
      // '..' を含む文字列がプレフィックス一致だけをすり抜けて pluginsDir の外を指さないよう、
      // 判定にも以降の join にも正規化後のパスを使う
      const installPath = normalize(rawInstallPath)
      if (!installPath.startsWith(normalizedPluginsDir + '/')) continue

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
  }
  return results
}
