/**
 * Claude Code SDK セッション
 *
 * `claude --output-format stream-json` を子プロセスとして起動し、
 * 構造化 JSON イベントを cc_* WebSocket メッセージに変換する。
 *
 * PTY を使わないため xterm.js 不要。モバイルはネイティブのチャット UI で
 * アシスタントメッセージ・ツール実行・承認リクエストを表示できる。
 */

import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { existsSync } from 'fs'
import { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import type { WsMessage, CcPermissionRequest } from '@remocoder/shared'

// ──────────────────────────────────────────────────────────────────────────────
// 内部型
// ──────────────────────────────────────────────────────────────────────────────

/** claude --output-format stream-json の assistant ブロック */
interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

/** claude --output-format stream-json の各行 */
interface ClaudeStreamEvent {
  type: string
  message?: { content?: ClaudeContentBlock[] }
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  tool_name?: string
  input?: unknown
  prompt?: string
  permission_id?: string
  subtype?: string
  session_id?: string
  result?: string
}

// ──────────────────────────────────────────────────────────────────────────────
// CcSession
// ──────────────────────────────────────────────────────────────────────────────

export class CcSession {
  private readonly proc: ChildProcess
  private wsClient: WebSocket | null

  constructor(
    public readonly sessionId: string,
    projectPath: string | undefined,
    wsClient: WebSocket | null,
    private readonly onExit: (exitCode: number) => void,
  ) {
    this.wsClient = wsClient

    const cwd =
      projectPath && existsSync(projectPath) ? projectPath : undefined

    this.proc = spawn('claude', ['--output-format', 'stream-json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      ...(cwd ? { cwd } : {}),
    })

    this.setupHandlers()
  }

  // ── 公開 API ─────────────────────────────────────────────────────────────

  setClient(ws: WebSocket | null): void {
    this.wsClient = ws
  }

  /** ユーザーメッセージを stdin 経由で送信する */
  sendUserMessage(content: string): void {
    if (!this.proc.stdin) {
      console.error(`[cc-session ${this.sessionId.slice(0, 8)}] stdin unavailable, cannot send user message`)
      this.send({
        type: 'cc_message',
        id: uuidv4(),
        role: 'assistant',
        content: 'エラー: セッションへのメッセージ送信に失敗しました（stdin が利用不可）',
        sessionId: this.sessionId,
      })
      return
    }
    this.proc.stdin.write(content + '\n')
  }

  /** Mobile からの承認/拒否応答を処理する */
  handlePermissionResponse(_permissionId: string, approved: boolean): void {
    if (!this.proc.stdin) {
      console.error(`[cc-session ${this.sessionId.slice(0, 8)}] stdin unavailable, cannot send permission response`)
      return
    }
    // claude は権限確認を stdin で受け取る（yes / no）
    this.proc.stdin.write((approved ? 'yes' : 'no') + '\n')
  }

  kill(): void {
    this.proc.kill()
  }

  // ── 内部ハンドラ ───────────────────────────────────────────────────────

  private send(msg: WsMessage): void {
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify(msg))
    }
  }

  private setupHandlers(): void {
    // spawn 自体の失敗（コマンドが存在しない等）を捕捉する
    this.proc.on('error', (err) => {
      console.error(`[cc-session ${this.sessionId.slice(0, 8)}] spawn error:`, err.message)
      this.send({
        type: 'cc_message',
        id: uuidv4(),
        role: 'assistant',
        content: `エラー: claude の起動に失敗しました（${err.message}）`,
        sessionId: this.sessionId,
      })
      this.onExit(1)
    })

    // stdout が null の場合（spawn 失敗時等）はスキップ
    if (this.proc.stdout) {
      const rl = createInterface({ input: this.proc.stdout })
      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        try {
          this.handleEvent(JSON.parse(trimmed) as ClaudeStreamEvent)
        } catch {
          // JSON でない行（デバッグ出力等）は無視
        }
      })
    }

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[cc-session ${this.sessionId.slice(0, 8)}] stderr:`, chunk.toString())
    })

    this.proc.on('exit', (code) => {
      console.log(`[cc-session ${this.sessionId.slice(0, 8)}] exited (code: ${code ?? 0})`)
      this.onExit(code ?? 0)
    })
  }

  private handleEvent(event: ClaudeStreamEvent): void {
    switch (event.type) {
      case 'assistant': {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            this.send({
              type: 'cc_message',
              id: uuidv4(),
              role: 'assistant',
              content: block.text,
              sessionId: this.sessionId,
            })
          } else if (block.type === 'tool_use' && block.id && block.name) {
            this.send({
              type: 'cc_tool_use',
              toolUseId: block.id,
              toolName: block.name,
              input: block.input ?? {},
              sessionId: this.sessionId,
            })
          }
        }
        break
      }

      case 'tool_result': {
        if (event.tool_use_id) {
          const content =
            typeof event.content === 'string'
              ? event.content
              : JSON.stringify(event.content ?? '')
          this.send({
            type: 'cc_tool_result',
            toolUseId: event.tool_use_id,
            content,
            isError: event.is_error ?? false,
            sessionId: this.sessionId,
          })
        }
        break
      }

      case 'permission_request': {
        const permissionId = event.permission_id ?? uuidv4()
        const req: CcPermissionRequest = {
          type: 'cc_permission_request',
          permissionId,
          toolName: event.tool_name ?? 'unknown',
          input: event.input ?? {},
          prompt: event.prompt ?? `Allow ${event.tool_name ?? 'tool'}?`,
          sessionId: this.sessionId,
        }
        this.send(req)
        break
      }

      case 'system': {
        if (event.subtype === 'init') {
          this.send({ type: 'cc_session_start', sessionId: this.sessionId })
        }
        break
      }

      case 'result': {
        if (event.subtype === 'error') {
          this.send({
            type: 'cc_message',
            id: uuidv4(),
            role: 'assistant',
            content: `エラーが発生しました: ${event.result ?? '不明なエラー'}`,
            sessionId: this.sessionId,
          })
        }
        break
      }
    }
  }
}
