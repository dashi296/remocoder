import { existsSync, readFileSync } from 'fs'
import { createConnection } from 'net'
import { homedir } from 'os'
import { join } from 'path'
import { type MultiplexerSessionInfo, isAgentStatus } from '@remocoder/shared'
import { execAsync, EXEC_ENV } from './exec-env'

/** herdr-core の CLI。`hc` はこのバイナリへのシンボリックリンク */
export const HERDR_CORE_BINARY = 'herdr-core'

/** アタッチ時に xterm.js 側へ渡すスクロールバック行数（hc attach はホイール操作を中継しないため） */
export const HERDR_CORE_ATTACH_HISTORY_LINES = 1000

/**
 * アドレス（例: t7, t1b）として許可する文字。別マシンの `machine/t7` は対象外。
 * 先頭の `-` はコマンドラインオプションと解釈されるため禁止する。
 */
const SAFE_ADDRESS_RE = /^[a-zA-Z0-9._][a-zA-Z0-9._-]*$/

/**
 * herdr-core を呼び出すための環境変数。
 * remocoder 自体が herdr-core のターミナル内で起動された場合、HC_TERMINAL_ID / HC_SCOPE を
 * 引き継ぐと hc がそのターミナルを親とみなして通知などを行うため取り除く。
 */
export function herdrCoreEnv(base: NodeJS.ProcessEnv = EXEC_ENV): NodeJS.ProcessEnv {
  const env = { ...base }
  delete env.HC_TERMINAL_ID
  delete env.HC_SCOPE
  return env
}

/** 直近の一覧取得で接続を確認したコアのソケット。アタッチ時も同じコアを指すために使う */
let lastHerdrCoreSocket: string | null = null

/** 確認済みのソケットを HC_SOCKET で指定し、古い HC_TERMINAL_SOCKET が残らないようにする */
function withHerdrCoreSocket(env: NodeJS.ProcessEnv, socket: string): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, HC_SOCKET: socket }
  delete next.HC_TERMINAL_SOCKET
  return next
}

/**
 * `hc attach` 用の環境変数。ソケットを HC_SOCKET で明示する。
 * 渡さないと hc が自身の環境変数（XDG_RUNTIME_DIR / HC_SESSION）から解決し直し、
 * 一覧と別のパスを選ぶと「HC_SOCKET differs from where the core started」で即終了する。
 * spawn は同期処理のため接続確認はできない。直近の一覧で確認したソケットのファイルが残っていればそれを、
 * なければ候補（core.lock の最新パスを含む）のうちファイルが存在する最初のものを使う。
 * コアは正常停止時にソケットファイルを削除するので、再起動でパスが変わった場合も新しいパスへ移る。
 */
export function herdrCoreAttachEnv(
  base: NodeJS.ProcessEnv = EXEC_ENV,
  resolveEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = herdrCoreEnv(base)
  const socket = [lastHerdrCoreSocket, ...herdrCoreSocketCandidates(resolveEnv)].find(
    (p): p is string => !!p && existsSync(p),
  )
  return socket ? withHerdrCoreSocket(env, socket) : env
}

export function herdrCoreAttachArgs(address: string): string[] {
  return ['attach', '--history', String(HERDR_CORE_ATTACH_HISTORY_LINES), address]
}

/**
 * コアのソケットパスの候補を優先順に返す。herdr-core 本体の解決順に合わせている:
 * - HC_TERMINAL_SOCKET: herdr-core のターミナル内で起動された場合にコアが渡すパス
 * - HC_SOCKET: 明示指定
 * - <state>/herdr-core/<session>/core.lock: 起動中のコアが実際に使っているパス（config の socket 指定も反映される）
 * - XDG_RUNTIME_DIR があれば <runtime>/herdr-core/<session>.sock（一般的な Linux）
 * - なければ <state>/herdr-core/<session>/<session>.sock（macOS など）
 */
export function herdrCoreSocketCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const session = env.HC_SESSION || 'default'
  const stateDir = join(env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'herdr-core', session)
  const candidates: string[] = []
  if (env.HC_TERMINAL_SOCKET) candidates.push(env.HC_TERMINAL_SOCKET)
  if (env.HC_SOCKET) candidates.push(env.HC_SOCKET)
  try {
    const locked = readFileSync(join(stateDir, 'core.lock'), 'utf8').split('\n')[0].trim()
    if (locked) candidates.push(locked)
  } catch { /* コアが一度も起動していない */ }
  if (env.XDG_RUNTIME_DIR) candidates.push(join(env.XDG_RUNTIME_DIR, 'herdr-core', `${session}.sock`))
  candidates.push(join(stateDir, `${session}.sock`))
  return [...new Set(candidates)]
}

/** 接続を受け付けるコアのソケットを返す。どれも応答しなければ null（コア停止中） */
export async function findHerdrCoreSocket(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const candidate of herdrCoreSocketCandidates(env)) {
    if (await isHerdrCoreRunning(candidate)) return candidate
  }
  return null
}

/**
 * コアが起動中か（ソケットが接続を受け付けるか）を確認する。
 * `hc ls` はコア停止中だとコアを起動してしまうため、一覧取得前に必ず確認する。
 */
export function isHerdrCoreRunning(socketPath: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath)
    const done = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

interface HcTerminal {
  address?: unknown
  agent?: unknown
  cwd?: unknown
  state?: unknown
  status?: unknown
  where?: unknown
}

/** `hc ls --json` の出力をセッション一覧へ変換する */
export function parseHerdrCoreList(stdout: string): MultiplexerSessionInfo[] {
  const parsed = JSON.parse(stdout) as { terminals?: unknown; error?: { message?: string } }
  if (parsed.error) {
    throw new Error(`[herdr-core] hc ls failed: ${parsed.error.message ?? 'unknown error'}`)
  }
  const terminals = Array.isArray(parsed.terminals) ? (parsed.terminals as HcTerminal[]) : []

  const results: MultiplexerSessionInfo[] = []
  for (const t of terminals) {
    if (typeof t.address !== 'string' || !SAFE_ADDRESS_RE.test(t.address)) continue
    if (t.state !== undefined && t.state !== 'live') continue

    // CLI の ls は status を文字列で返す。API の Terminal 型はオブジェクト（{ state, msg }）なので両対応する
    let statusWord: unknown = t.status
    let statusMessage: string | undefined
    if (t.status && typeof t.status === 'object') {
      const s = t.status as { state?: unknown; msg?: unknown }
      statusWord = s.state
      if (typeof s.msg === 'string' && s.msg) statusMessage = s.msg
    }

    results.push({
      tool: 'herdr-core',
      sessionName: t.address,
      detail: typeof t.where === 'string' && t.where ? t.where : undefined,
      workingDirectory: typeof t.cwd === 'string' && t.cwd ? t.cwd : undefined,
      agent: typeof t.agent === 'string' && t.agent ? t.agent : undefined,
      agentStatus: isAgentStatus(statusWord) ? statusWord : undefined,
      agentStatusMessage: statusMessage,
    })
  }
  return results
}

/** `hc get <t> --json` から状態メッセージを取り出す（`hc ls` の status は文字列のみでメッセージを含まないため） */
export function parseHerdrCoreStatusMessage(stdout: string): string | undefined {
  const parsed = JSON.parse(stdout) as { status?: { msg?: unknown } | null }
  const msg = parsed.status?.msg
  return typeof msg === 'string' && msg ? msg : undefined
}

/**
 * herdr-core のライブターミナル一覧を取得する。コア停止中は空配列。
 * remocoder 自身が動いているターミナル（HC_TERMINAL_ID）は除外する。
 */
export async function collectHerdrCoreSessions(): Promise<MultiplexerSessionInfo[]> {
  const socket = await findHerdrCoreSocket()
  lastHerdrCoreSocket = socket
  if (!socket) return []
  // 確認したソケットを明示し、hc が別のパスを解決して新しいコアを起動するのを防ぐ
  const env = withHerdrCoreSocket(herdrCoreEnv(), socket)
  const ownAddress = process.env.HC_TERMINAL_ID
  let sessions: MultiplexerSessionInfo[]
  try {
    const { stdout } = await execAsync(`${HERDR_CORE_BINARY} ls --json`, { env })
    sessions = parseHerdrCoreList(stdout).filter((s) => s.sessionName !== ownAddress)
  } catch (err) {
    // 呼び出し側は Promise.allSettled で失敗を捨てるため、原因をここで残す
    console.warn('[herdr-core] failed to list terminals:', err instanceof Error ? err.message : err)
    throw err
  }
  // 状態を報告しているターミナルのみメッセージを個別取得する。失敗してもメッセージなしで続行する
  return Promise.all(
    sessions.map(async (s) => {
      if (!s.agentStatus || s.agentStatusMessage) return s
      try {
        const res = await execAsync(`${HERDR_CORE_BINARY} get ${s.sessionName} --json`, { env })
        return { ...s, agentStatusMessage: parseHerdrCoreStatusMessage(res.stdout) }
      } catch {
        return s
      }
    }),
  )
}
