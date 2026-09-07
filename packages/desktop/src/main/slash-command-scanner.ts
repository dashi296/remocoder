/**
 * Claude Code のスラッシュコマンド（コマンド定義とスキル）を走査して一覧化する。
 *
 * 依存を増やさないため glob ライブラリは使わず Node の fs API のみで実装する。
 */

import { constants as fsConstants } from 'fs'
import { open, readdir, realpath, stat, type FileHandle } from 'fs/promises'
import { join, basename, normalize, isAbsolute, relative, resolve } from 'path'
import { homedir } from 'os'
import { SlashCommandInfo, SessionSource } from '@remocoder/shared'

// readdir(dir, { withFileTypes: true }) の要素型。
// `typeof readdir` に対する ReturnType はオーバーロードの解決先が曖昧になり
// （Buffer 版の戻り値型が選ばれてしまう）、'fs' から import した Dirent 型とも
// 構造的に一致しないことがある（@types/node のバージョン差）。
// そのため、実際に withFileTypes: true を渡す呼び出し1つを経由してオーバーロードを
// 確定させ、そこから要素型を導出する
function readDirWithTypes(path: string) {
  return readdir(path, { withFileTypes: true })
}
type DirEntry = Awaited<ReturnType<typeof readDirWithTypes>>[number]

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

/**
 * 呼び出し名として安全な文字だけからなるかを判定する。
 *
 * この名前は最終的にモバイル側で `/${name}` として組み立てられ、
 * `window.sendInput` 経由で PTY にそのまま書き込まれる（TerminalScreen.tsx）。
 * CR がそこに混ざると、コマンドを選んだだけで Enter を押したのと同じ効果になり、
 * ESC が混ざれば端末エスケープシーケンスを注入できてしまう。
 * これはコマンド定義ファイル名・スキルディレクトリ名・プラグイン名など、
 * SlashCommandInfo.name の元になりうるすべての入力から来る可能性があるため、
 * それぞれの走査関数が SlashCommandInfo を組み立てる直前に、この許可リストで検証する。
 */
const SAFE_COMMAND_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/

export function isSafeCommandName(name: string): boolean {
  return SAFE_COMMAND_NAME_PATTERN.test(name)
}

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

// FIFO などの特殊ファイルを開くと、open() が書き手が現れるまで待ち続けうる。
// また、ネットワークファイルシステムや FUSE マウント、応答しないデバイス上では、
// open/fstat/read/readdir/realpath のいずれも長時間ブロックしうる。
// O_NONBLOCK は FIFO の open 待ちを防ぐが、個々の I/O 呼び出しそのものを
// 中断可能にはしない。それでも fs/promises を使って各 I/O を非同期化するのは、
// 1回の遅い呼び出しが Electron のメインプロセス（PTY 中継・WebSocket・UI）を
// 丸ごと停止させないようにするため、かつ await の間で deadline チェックが
// 実際に働くようにするためである。
//
// stat() で種別を確認してから open() で開く、という2段階の実装は
// TOCTOU（Time-Of-Check to Time-Of-Use）で崩れる。stat が通った直後に
// 同じパスへ FIFO や巨大ファイルを差し替えられると、check は通過済みなので
// open はチェックなしのパスをそのまま開いてしまう。
//
// 対策として、種別の確認は「これから読むファイルハンドル」自身に対して
// handle.stat() で行う。open した後に差し替えても、既に開いたハンドルが指す
// 実体は変わらないため、この確認はすり替えの影響を受けない。
// また open 自体に O_NONBLOCK を付け、FIFO を開いても待たされないようにする
// （通常ファイルに対しては no-op）。O_NONBLOCK は Windows の fs.constants には
// 存在しないため、その場合は 0 にフォールバックする。
const O_NONBLOCK = fsConstants.O_NONBLOCK ?? 0

/** チェック（stat）と読み取りに使う FileHandle を安全に開く。通常ファイルでなければ null */
async function openRegularFile(filePath: string): Promise<{ handle: FileHandle; size: number } | null> {
  let handle: FileHandle
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | O_NONBLOCK)
  } catch {
    // ENOENT・ENXIO・EACCES など。存在しない/開けない場合はスキップ扱いにする
    return null
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) {
      await handle.close()
      return null
    }
    return { handle, size: st.size }
  } catch {
    await handle.close()
    return null
  }
}

/** ファイル先頭の maxBytes だけ読む。巨大な Markdown 全体を読まないため */
async function readHead(filePath: string, maxBytes = MAX_HEAD_BYTES): Promise<string> {
  const opened = await openRegularFile(filePath)
  if (!opened) {
    throw new Error(`not a regular file: ${filePath}`)
  }
  const { handle } = opened
  try {
    const buf = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0)
    return buf.subarray(0, bytesRead).toString('utf-8')
  } finally {
    await handle.close()
  }
}

/** ファイルの存在確認だけを行う。読み取りはしない（existsSync の非同期版） */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
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
async function enterDirectory(dir: string, ctx: ScanContext): Promise<boolean> {
  let real: string
  try {
    real = await realpath(dir)
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
export async function scanCommandsDir(
  root: string,
  scope: 'user' | 'project' | 'plugin',
  ctx: ScanContext,
): Promise<SlashCommandInfo[]> {
  const results: SlashCommandInfo[] = []

  async function walk(dir: string, depth: number, relDir: string): Promise<void> {
    if (depth >= MAX_DEPTH) return
    if (isExhausted(ctx)) return
    if (!(await enterDirectory(dir, ctx))) return
    // enterDirectory 内の realpath で時間が経過している可能性があるため、
    // readdir という次の I/O を始める前に再確認する
    if (isExhausted(ctx)) return

    let entries: DirEntry[]
    try {
      entries = await readDirWithTypes(dir)
    } catch {
      return
    }
    // readdir 自体に時間がかかった場合に備え、エントリを処理し始める前にも確認する
    if (isExhausted(ctx)) return

    for (const entry of entries) {
      if (isExhausted(ctx)) return
      const full = join(dir, entry.name)

      // withFileTypes はリンクを解決しないので、リンクの場合は stat で種別を判定する
      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          const st = await stat(full)
          isDir = st.isDirectory()
          isFile = st.isFile()
        } catch {
          continue
        }
        // stat() の await 中に時間が経過している可能性があるため、次の I/O
        // （walk への再帰 or readHead）を始める前に再確認する
        if (isExhausted(ctx)) return
      }

      if (isDir) {
        await walk(full, depth + 1, relDir ? `${relDir}/${entry.name}` : entry.name)
        continue
      }
      if (!isFile || !entry.name.endsWith('.md')) continue

      const name = basename(entry.name, '.md')
      if (!isSafeCommandName(name)) continue

      ctx.fileCount++
      let front: Record<string, string> = {}
      try {
        front = parseFrontmatter(await readHead(full))
      } catch {
        continue
      }

      const info: SlashCommandInfo = {
        name,
        scope,
      }
      const description = truncateDescription(front.description)
      if (description) info.description = description
      if (relDir) info.namespace = `${scope}:${relDir}`
      results.push(info)
    }
  }

  await walk(root, 0, '')
  return results
}

/**
 * スキルディレクトリ（`<root>/<name>/SKILL.md`）を走査する。
 * 呼び出し名はディレクトリ名。`user-invocable: false` は除外する。
 */
export async function scanSkillsDir(
  root: string,
  scope: 'user' | 'project' | 'plugin',
  ctx: ScanContext,
  pluginName?: string,
): Promise<SlashCommandInfo[]> {
  if (isExhausted(ctx)) return []
  if (!(await enterDirectory(root, ctx))) return []
  // enterDirectory 内の realpath で時間が経過している可能性があるため、
  // readdir という次の I/O を始める前に再確認する
  if (isExhausted(ctx)) return []

  let entries: DirEntry[]
  try {
    entries = await readDirWithTypes(root)
  } catch {
    return []
  }
  // readdir 自体に時間がかかった場合に備え、エントリを処理し始める前にも確認する
  if (isExhausted(ctx)) return []

  const results: SlashCommandInfo[] = []
  for (const entry of entries) {
    if (isExhausted(ctx)) break
    const skillDir = join(root, entry.name)
    const skillFile = join(skillDir, 'SKILL.md')
    if (!(await pathExists(skillFile))) continue
    // pathExists の stat で時間が経過している可能性があるため、
    // 実際に読む（ctx.fileCount++ / readHead）前に再確認する
    if (isExhausted(ctx)) break

    const name = pluginName ? `${pluginName}:${entry.name}` : entry.name
    if (!isSafeCommandName(name)) continue

    ctx.fileCount++
    let front: Record<string, string> = {}
    try {
      front = parseFrontmatter(await readHead(skillFile))
    } catch {
      continue
    }
    if (front['user-invocable'] === 'false') continue

    const info: SlashCommandInfo = {
      name,
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
export async function scanPluginRootSkill(
  installPath: string,
  pluginName: string,
  ctx: ScanContext,
): Promise<SlashCommandInfo[]> {
  if (isExhausted(ctx)) return []
  const skillFile = join(installPath, 'SKILL.md')
  if (!(await pathExists(skillFile))) return []
  // pathExists の stat で時間が経過している可能性があるため、
  // 実際に読む（ctx.fileCount++ / readHead）前に再確認する
  if (isExhausted(ctx)) return []

  ctx.fileCount++
  let front: Record<string, string> = {}
  try {
    front = parseFrontmatter(await readHead(skillFile))
  } catch {
    return []
  }
  if (front['user-invocable'] === 'false') return []

  const name = front.name ? `${pluginName}:${front.name}` : pluginName
  if (!isSafeCommandName(name)) return []

  const info: SlashCommandInfo = {
    name,
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

/** JSON として読むファイルの最大バイト数。無制限に読むとファイル/時間の budget を無視して長時間ブロックしうる */
export const MAX_JSON_BYTES = 1024 * 1024

/**
 * 1つの manifest の commands/skills が指定してよい最大ディレクトリ数。
 * 上限がないと、1件の manifest がいくらでも多くのディレクトリ走査を予約でき、
 * ctx.fileCount / deadline の budget を大きく消費させられる。
 */
export const MAX_MANIFEST_DIRS = 16

/**
 * JSON ファイルを読む。存在しない・壊れている・通常ファイルでない・
 * サイズが上限を超える場合は null（読まない）。
 *
 * readHead と同様、種別とサイズの確認は開いた FileHandle に対して handle.stat() で行う
 * （TOCTOU 対策）。stat してから別途 open/read するとパスを差し替えられうる。
 *
 * ctx を渡した場合は budget（ファイル数・deadline）を消費する。
 * resolveEnabledPlugins 系列の呼び出しは、getSlashCommands が管理する
 * 「500ファイル/3秒」の budget にここでの読み取りも含めるため、必ず ctx を渡す。
 * ctx が既に尽きていれば開かずに null を返す（isExhausted が truncated を立てる）。
 * ファイルを開こうとした時点で1ファイルとして数える。存在しない・壊れているなど
 * 結局読めなかった場合も「読もうとした」試行として数える。
 */
async function readJson(filePath: string, ctx?: ScanContext): Promise<unknown> {
  if (ctx) {
    if (isExhausted(ctx)) return null
    ctx.fileCount++
  }
  const opened = await openRegularFile(filePath)
  if (!opened) return null
  const { handle, size } = opened
  try {
    // openRegularFile 内の open/fstat で時間が経過している可能性があるため、
    // 実際の読み取りを始める前に再確認する（handle は finally で必ず閉じる）
    if (ctx && isExhausted(ctx)) return null
    if (size > MAX_JSON_BYTES) return null
    const buf = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await handle.read(buf, offset, size - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
      // 部分的な読み取り（await）の直後に時間が経過している可能性があるため、
      // 次の handle.read() を始める前に再確認する。ここで打ち切った場合、
      // buf は最後まで埋まっていないため、そのまま JSON.parse すると
      // たまたま途中まででも構文として妥当な断片を誤って解釈しかねない。
      // budget 超過は「読めなかった」場合と同様に扱い、明示的に null を返す
      if (ctx && isExhausted(ctx)) return null
    }
    return JSON.parse(buf.subarray(0, offset).toString('utf-8'))
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/**
 * 設定ファイル群の enabledPlugins をマージする。
 * settingsPaths は優先度の低い順に渡す（後ろが前を上書きする）。
 * ctx の budget が尽きた時点で以降の設定ファイルは読まない。
 */
async function mergeEnabledPlugins(
  settingsPaths: string[],
  ctx: ScanContext,
): Promise<Record<string, boolean>> {
  const merged: Record<string, boolean> = {}
  for (const path of settingsPaths) {
    if (isExhausted(ctx)) break
    const json = (await readJson(path, ctx)) as { enabledPlugins?: Record<string, boolean> } | null
    if (!json || typeof json.enabledPlugins !== 'object' || json.enabledPlugins === null) continue
    for (const [key, value] of Object.entries(json.enabledPlugins)) {
      if (typeof value === 'boolean') merged[key] = value
    }
  }
  return merged
}

/**
 * manifest のパス指定を絶対パスの配列にする。未指定なら defaultDir を使う。
 * MAX_MANIFEST_DIRS を超える指定は切り捨てる（budget を無制限に予約させないため）。
 *
 * ファイルシステムに触れない純粋な文字列操作なので、非同期化の対象ではない。
 */
function resolveManifestDirs(
  installPath: string,
  value: unknown,
  defaultDir: string,
): string[] {
  const raw = value === undefined ? [defaultDir] : Array.isArray(value) ? value : [value]
  const dirs: string[] = []
  for (const entry of raw) {
    if (dirs.length >= MAX_MANIFEST_DIRS) break
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
 *
 * ここで読む installed_plugins.json・各設定ファイル・各プラグインの plugin.json は
 * すべて ctx の budget（ファイル数・deadline）を消費する。呼び出し元の走査全体
 * （getSlashCommands）が「最大 500 ファイル / 3 秒」を守るには、ここでの読み取りも
 * その budget に含める必要がある。
 */
export async function resolveEnabledPlugins(
  pluginsDir: string,
  settingsPaths: string[],
  ctx: ScanContext,
): Promise<PluginRoot[]> {
  if (isExhausted(ctx)) return []

  const installed = (await readJson(join(pluginsDir, 'installed_plugins.json'), ctx)) as
    | { plugins?: Record<string, Array<{ installPath?: unknown }>> }
    | null
  if (!installed || typeof installed.plugins !== 'object' || installed.plugins === null) return []

  const enabled = await mergeEnabledPlugins(settingsPaths, ctx)
  const roots: PluginRoot[] = []
  // normalize はファイルシステムに触れずシンボリックリンクも解決しない純粋な文字列操作なので、
  // 「リンク解決前の文字列で判定する」というルールに反しない
  const normalizedPluginsDir = normalize(pluginsDir)

  outer: for (const [key, records] of Object.entries(installed.plugins)) {
    if (isExhausted(ctx)) break
    if (enabled[key] !== true) continue
    if (!Array.isArray(records)) continue

    for (const record of records) {
      if (isExhausted(ctx)) break outer
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

      const manifest = (await readJson(join(installPath, '.claude-plugin', 'plugin.json'), ctx)) as
        | { name?: unknown; commands?: unknown; skills?: unknown }
        | null
      if (!manifest || typeof manifest.name !== 'string' || !manifest.name) continue
      // 不正な name は呼び出し名の一部になるため、コマンド単位ではなくプラグイン単位で除外する
      if (!isSafeCommandName(manifest.name)) continue

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
export async function scanPlugins(roots: PluginRoot[], ctx: ScanContext): Promise<SlashCommandInfo[]> {
  const results: SlashCommandInfo[] = []
  for (const root of roots) {
    // budget が尽きていれば残りのプラグインには入らない
    if (isExhausted(ctx)) break
    for (const dir of root.commandsDirs) {
      // scope に 'plugin' を渡すことで、サブディレクトリ由来の namespace も
      // 'plugin:<subdir>' として正しく組み立てられる
      for (const cmd of await scanCommandsDir(dir, 'plugin', ctx)) {
        const name = `${root.name}:${cmd.name}`
        // root.name・cmd.name はそれぞれ既に検証済みだが、連結すると
        // 100文字上限を超えうるため、連結後の名前も改めて検証する
        if (!isSafeCommandName(name)) continue
        // namespace など既存フィールドを落とさないよう先に展開する
        results.push({
          ...cmd,
          name,
          pluginName: root.name,
        })
      }
    }
    for (const dir of root.skillsDirs) {
      results.push(...(await scanSkillsDir(dir, 'plugin', ctx, root.name)))
    }
    results.push(...(await scanPluginRootSkill(root.installPath, root.name, ctx)))
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

type SlashCommandsResult = { commands: SlashCommandInfo[]; truncated: boolean }

/**
 * getSlashCommands のキャッシュ（30秒TTL）。claudeDir と projectPath の組ごとに分ける。
 *
 * 値は走査結果そのものではなく Promise を持つ。これにより、同じキーへの
 * リクエストが走査の完了前に重ねて届いても、2回目以降は同じ Promise を
 * 待つだけになり、重複した走査（ファイルシステムへの二重アクセス）が起きない。
 * 走査が失敗した場合は getSlashCommands 内の catch がこのエントリ自体を
 * 削除するため、次の呼び出しは新しい走査からやり直す（失敗した Promise が
 * キャッシュに残り続けることはない）。
 */
const commandsCache = new Map<
  string,
  { promise: Promise<SlashCommandsResult>; expiry: number }
>()

const CACHE_TTL_MS = 30000

/**
 * キャッシュの最大保持件数。
 * 認証済みクライアントは session_create 経由で projectPath を自由に指定できるため、
 * 正規化後も無制限にエントリが増え続けないよう上限を設ける。
 */
export const MAX_CACHE_ENTRIES = 32

/** テスト用にキャッシュを破棄する */
export function clearSlashCommandCache(): void {
  commandsCache.clear()
  // inFlightByRawKey も相乗り用のキャッシュ層の一部なので、テスト間で
  // 汚染が残らないようここでも破棄する
  inFlightByRawKey.clear()
}

/** テスト用に現在のキャッシュ件数を取得する */
export function getSlashCommandCacheSize(): number {
  return commandsCache.size
}

/**
 * commandsCache に書き込む前の後始末。期限切れのエントリを掃除し、
 * それでも上限に達していれば最も古いエントリ（Map の挿入順の先頭）を追い出す。
 */
function pruneCache(now: number, newKey: string): void {
  for (const [key, entry] of commandsCache) {
    if (now >= entry.expiry) commandsCache.delete(key)
  }
  if (!commandsCache.has(newKey) && commandsCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = commandsCache.keys().next().value
    if (oldestKey !== undefined) commandsCache.delete(oldestKey)
  }
}

/** projectPath が走査してよい値か検証する。絶対パスかつ実在するディレクトリのみ許す */
async function validProjectPath(projectPath: unknown): Promise<string | null> {
  // isAbsolute は Windows の 'C:\...' もカバーする（startsWith('/') は POSIX 専用だった）
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath)) return null
  try {
    if (!(await stat(projectPath)).isDirectory()) return null
  } catch {
    return null
  }
  // キャッシュキーをパスの表記ゆれ（末尾の "/." や "/a/.." など）に依存させないための
  // 正規化。resolve はファイルシステムに触れずシンボリックリンクも解決しない純粋な
  // 文字列操作なので、「リンク解決前の文字列で判定する」というルールには反しない
  const lexical = resolve(projectPath)
  // さらに実体のパスに解決する。lexical のままだと、同じディレクトリを指す
  // 異なるシンボリックリンク経由のパスがそれぞれ別のキャッシュキーになり、
  // 認証済みクライアントが symlink のエイリアスを次々作ることで
  // キャッシュ（最大 MAX_CACHE_ENTRIES 件）を無限に追い出させ、走査を
  // 再実行させ続けられてしまう。realpath が失敗した場合（レース等）は
  // lexical にフォールバックする。上記の絶対パス・ディレクトリ判定は
  // 解決前の文字列に対して行っており、ここでの解決はキャッシュキー・走査対象の
  // 決定にのみ影響する。
  try {
    return await realpath(lexical)
  } catch {
    return lexical
  }
}

/**
 * 実際の走査本体。キャッシュや重複排除には関与しない
 * （それらは getSlashCommands 側の責務）。
 */
async function performScan(
  claudeDir: string,
  projectPath: string | null,
  ctx: ScanContext,
): Promise<SlashCommandsResult> {
  // 走査の順序は「500ファイル/3秒」の budget を優先度の高いスコープから
  // 消費させるためのものであり、同名の重複解決とは無関係（重複解決は下の
  // SCOPE_PRIORITY テーブルで名前ごとに行うため順序に依存しない）。
  // project を先頭に置かないと、user・plugin の走査だけで budget を使い切った
  // 場合に最優先スコープの project が丸ごと落ちてしまう。
  // 「読みやすさ」のために project スコープをここから動かさないこと。
  // 配列リテラル内の各要素は左から右へ順に評価されるため、await を挟んでも
  // このスコープ順（project → user → plugin → builtin）は保たれる。
  const collected: SlashCommandInfo[] = [
    ...(projectPath
      ? [
          ...(await scanCommandsDir(join(projectPath, '.claude', 'commands'), 'project', ctx)),
          ...(await scanSkillsDir(join(projectPath, '.claude', 'skills'), 'project', ctx)),
        ]
      : []),
    ...(await scanCommandsDir(join(claudeDir, 'commands'), 'user', ctx)),
    ...(await scanSkillsDir(join(claudeDir, 'skills'), 'user', ctx)),
    ...(await scanPlugins(
      await resolveEnabledPlugins(
        join(claudeDir, 'plugins'),
        [
          join(claudeDir, 'settings.json'),
          ...(projectPath
            ? [
                join(projectPath, '.claude', 'settings.json'),
                join(projectPath, '.claude', 'settings.local.json'),
              ]
            : []),
        ],
        ctx,
      ),
      ctx,
    )),
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

  // 走査中の各所で isExhausted を呼んでいても、最後に行われた I/O（例えば
  // 最後のプラグインの root SKILL.md 読み取り）が完了した直後に deadline を
  // 超えていた場合、それ以降どこにも isExhausted の呼び出し機会がなければ
  // truncated に反映されないまま返ってしまう。budget 超過を見逃さないよう、
  // 返す直前に必ずもう一度評価する（呼び出し自体が ctx.truncated を更新する）
  isExhausted(ctx)

  return {
    commands: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    truncated: ctx.truncated,
  }
}

/**
 * 検証中（validProjectPath）または走査中（performScan）の Promise を、
 * 「生の入力」ベースのキーで共有するための Map。
 *
 * commandsCache は検証済み・正規化済みのパスをキーにしているため、
 * 応答の遅いファイルシステム上で同じ raw な projectPath への同時リクエストが
 * 複数届くと、検証（validProjectPath の stat/realpath）が commandsCache に
 * 触れる前の段階でそれぞれ独立に走ってしまい、相乗りの機会がない。
 * ここではキーを検証前の「生の」文字列（claudeDir + source.projectPath そのもの）
 * にすることで、検証も含めて同じ入力への同時呼び出しを1本化する。
 * 2つの異なる raw な綴り（symlink エイリアスなど）が同じ実体を指す場合は、
 * このレベルでは別エントリのままだが、検証後は commandsCache 側の realpath
 * 正規化によって同じキーに収束するため、従来通り重複走査は起きない。
 */
const inFlightByRawKey = new Map<string, Promise<SlashCommandsResult>>()

/**
 * inFlightByRawKey の最大保持件数。
 *
 * このエントリは自身の Promise が決着すれば自動的に削除されるが、応答の
 * 遅い（あるいは応答しない）ファイルシステム上では、複数のソケットや
 * raw な綴りの違い（symlink エイリアス・末尾の "/." など）から同時に
 * 多数のエントリが積み上がりうる。ソケットごとの同時実行数は pty-server 側
 * （inFlightCommandListScan）で1本に制限しているが、それはソケット単位の
 * 上限であり、この Map はソケットをまたいだグローバルな状態である。
 * commandsCache（MAX_CACHE_ENTRIES）と同様に、ここでも上限を設けて
 * 無制限に増え続けないようにする。
 *
 * 上限に達して追い出されたエントリは、相乗りの機会を失うだけで、追い出し
 * 自体が進行中の Promise を取り消すわけではない（そのまま完了まで走る）。
 */
export const MAX_INFLIGHT_RAW_KEYS = 64

/**
 * inFlightByRawKey に書き込む前の後始末。上限に達していれば最も古い
 * エントリ（Map の挿入順の先頭）を追い出す。pruneCache と異なり TTL による
 * 期限切れの概念はない（決着したエントリは自身で削除されるため）。
 */
function pruneInFlightByRawKey(newKey: string): void {
  if (!inFlightByRawKey.has(newKey) && inFlightByRawKey.size >= MAX_INFLIGHT_RAW_KEYS) {
    const oldestKey = inFlightByRawKey.keys().next().value
    if (oldestKey !== undefined) inFlightByRawKey.delete(oldestKey)
  }
}

/** テスト用に inFlightByRawKey の現在のエントリ数を取得する */
export function getInFlightRawKeyCount(): number {
  return inFlightByRawKey.size
}

/**
 * セッションの起動元に応じたスラッシュコマンド一覧を返す。
 *
 * Codex など別ツールに対応する場合は、この switch に case を足す。
 */
export async function getSlashCommands(
  source: SessionSource | undefined,
  // claudeDir はテストから一時ディレクトリを渡すための引数。本番では省略する
  options: { claudeDir?: string } = {},
): Promise<SlashCommandsResult> {
  switch (source?.kind) {
    case 'claude':
      break
    default:
      return { commands: [], truncated: false }
  }

  const claudeDir = options.claudeDir ?? join(homedir(), '.claude')
  const rawProjectPath = typeof source.projectPath === 'string' ? source.projectPath : '<none>'
  const rawKey = `${claudeDir}|${rawProjectPath}`

  // 同じ raw キーへの呼び出しが既に検証中・走査中であれば、そのまま相乗りする。
  // ここでの判定から下の Map への登録までの間に await を挟まないことが重要
  // （挟むと、その隙に届いた同時呼び出しが相乗りする機会を逃す）。
  const existing = inFlightByRawKey.get(rawKey)
  if (existing) return existing

  const resultPromise: Promise<SlashCommandsResult> = (async () => {
    // validProjectPath は ScanContext（walk の budget）が作られる前に走る検証であり、
    // ここで費やす時間は意図的に「500ファイル/3秒」の budget の外側にある。
    // キャッシュキー（正規化された projectPath）を決めるための前処理であって
    // 走査そのものではないため、ctx 管理下に置く必要はないという判断による。
    const projectPath = await validProjectPath(source.projectPath)
    const cacheKey = `${claudeDir}|${projectPath ?? '<none>'}`
    const now = Date.now()
    const cached = commandsCache.get(cacheKey)
    if (cached && now < cached.expiry) return cached.promise

    const ctx = createScanContext()

    // 走査中の Promise を即座にキャッシュへ入れる。cached の判定から
    // ここまでの間に await を挟んでいないため、同じキーに対する後続の
    // 呼び出しはこの Promise を見つけて相乗りできる（走査の二重実行を防ぐ）。
    const scanPromise: Promise<SlashCommandsResult> = performScan(claudeDir, projectPath, ctx).catch((err) => {
      // 走査が失敗した場合、失敗した Promise をキャッシュに残さない。
      // 残すと、次の呼び出しも同じ rejected Promise を待つだけになり、
      // TTL が切れるまで再走査の機会が失われてしまう。
      const entry = commandsCache.get(cacheKey)
      if (entry && entry.promise === scanPromise) commandsCache.delete(cacheKey)
      throw err
    })

    pruneCache(now, cacheKey)
    commandsCache.set(cacheKey, { promise: scanPromise, expiry: now + CACHE_TTL_MS })
    return scanPromise
  })()

  pruneInFlightByRawKey(rawKey)
  inFlightByRawKey.set(rawKey, resultPromise)
  // 成功・失敗いずれの場合も、決着したら raw キーの相乗り対象から外す。
  // ここで .then(onFulfilled, onRejected) を使うのは、.finally() だと元の
  // rejection を伝播した新しい Promise ができてしまい、誰も待たないその
  // Promise が unhandled rejection として扱われうるため
  // （resultPromise 自体は呼び出し元が受け取って処理する）。
  const clearInFlight = (): void => {
    if (inFlightByRawKey.get(rawKey) === resultPromise) inFlightByRawKey.delete(rawKey)
  }
  resultPromise.then(clearInFlight, clearInFlight)

  return resultPromise
}
