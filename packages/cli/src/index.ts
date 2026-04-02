#!/usr/bin/env node
/**
 * remocoder-claude
 *
 * 外部ターミナルで起動したclaudeセッションをRemoCoderに登録するCLIツール。
 * このコマンドはclaudeの代わりに使用する：
 *
 *   remocoder-claude           # claudeを起動してRemoCoderに登録
 *   remocoder-claude --resume  # 再開フラグ付きで起動
 *
 * 初回セットアップ：
 *   echo 'alias claude="remocoder-claude"' >> ~/.zshrc
 */

import WebSocket from 'ws'
import * as pty from 'node-pty'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir, platform } from 'os'
import { DEFAULT_WS_PORT } from '@remocoder/shared'
import type { WsMessage } from '@remocoder/shared'

// ── トークン解決 ────────────────────────────────────────────────────────────

function getTokenFilePath(): string {
  const os = platform()
  if (os === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'RemoCoder', 'auth-token.json')
  } else if (os === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'RemoCoder', 'auth-token.json')
  } else {
    return join(homedir(), '.config', 'RemoCoder', 'auth-token.json')
  }
}

function resolveToken(): string {
  // 環境変数が最優先
  if (process.env.REMOCODER_TOKEN) return process.env.REMOCODER_TOKEN

  // Electron アプリが保存したトークンファイルから読み込む
  const tokenPath = getTokenFilePath()
  try {
    const { token } = JSON.parse(readFileSync(tokenPath, 'utf-8'))
    if (typeof token === 'string' && token.length > 0) return token
  } catch {
    // 読み込み失敗時は下へ
  }

  console.error(`[remocoder-claude] トークンが見つかりません。`)
  console.error(`  RemoCoderデスクトップアプリが起動しているか確認してください。`)
  console.error(`  または環境変数 REMOCODER_TOKEN にトークンを設定してください。`)
  process.exit(1)
}

// ── メイン ──────────────────────────────────────────────────────────────────

const WS_HOST = process.env.REMOCODER_HOST ?? 'localhost'
const WS_URL = `ws://${WS_HOST}:${DEFAULT_WS_PORT}`
const claudeArgs = process.argv.slice(2)

const token = resolveToken()

console.log(`[remocoder-claude] RemoCoderに接続中 (${WS_URL})...`)

const ws = new WebSocket(WS_URL)
let shell: pty.IPty | null = null

function getTermSize(): { cols: number; rows: number } {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 30 }
}

function safeSend(msg: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

// プロセス終了シグナルの処理
process.on('SIGINT', () => shell?.kill())
process.on('SIGTERM', () => shell?.kill())

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token } satisfies WsMessage))
})

ws.on('message', (raw) => {
  let msg: WsMessage
  try {
    msg = JSON.parse(raw.toString())
  } catch {
    return
  }

  if (msg.type === 'auth_ok') {
    const { cols, rows } = getTermSize()
    safeSend({ type: 'session_register', cols, rows })
  } else if (msg.type === 'session_registered') {
    if (shell) return

    console.log(`[remocoder-claude] セッション登録完了 (ID: ${msg.sessionId.slice(0, 8)}...)`)
    console.log(`[remocoder-claude] モバイルアプリのセッション一覧に表示されます\n`)

    // claude を PTY で起動
    const { cols, rows } = getTermSize()
    shell = pty.spawn('claude', claudeArgs, {
      name: 'xterm-color',
      cols,
      rows,
      env: { ...process.env },
      cwd: process.cwd(),
    })

    // PTY出力 → ローカル端末 + RemoCoderサーバーへ転送
    shell.onData((data) => {
      process.stdout.write(data)
      safeSend({ type: 'output', data })
    })

    shell.onExit(({ exitCode }) => {
      shell = null
      safeSend({ type: 'shell_exit', exitCode })
      ws.close()
      process.exit(exitCode)
    })

    // ローカル端末のキー入力 → PTY へ
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.on('data', (data) => {
      shell?.write(data.toString('binary'))
    })

    // ターミナルリサイズ → PTY + サーバーへ通知
    process.stdout.on('resize', () => {
      const { cols, rows } = getTermSize()
      shell?.resize(cols, rows)
      safeSend({ type: 'resize', cols, rows })
    })
  } else if (msg.type === 'auth_error') {
    console.error(`[remocoder-claude] 認証エラー: ${msg.reason}`)
    console.error(`  トークンが正しいか確認してください。`)
    process.exit(1)
  } else if (msg.type === 'input') {
    // モバイルからの入力 → PTY へ
    shell?.write(msg.data)
  } else if (msg.type === 'resize') {
    // モバイルからのリサイズ → PTY へ
    shell?.resize(msg.cols, msg.rows)
  } else if (msg.type === 'ping') {
    safeSend({ type: 'pong' })
  }
})

ws.on('error', (err) => {
  console.error(`[remocoder-claude] 接続エラー: ${err.message}`)
  console.error(`  RemoCoderデスクトップアプリが起動しているか確認してください。`)
  process.exit(1)
})

ws.on('close', () => {
  if (shell) {
    shell.kill()
  }
  process.stdin.pause()
})
