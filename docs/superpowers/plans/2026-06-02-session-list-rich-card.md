# Session List Rich Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セッション一覧を Rich Card 形式に刷新し、プロジェクト名・種別アイコン・経過時間・最終出力プレビュー・Claudeフェーズ・ユーザー定義ラベルを表示できるようにする。

**Architecture:** `shared/types.ts` の `SessionInfo` に3フィールドを追加し、`pty-server.ts` が PTY 出力のたびにフィールドを更新する。Desktop の `SessionList` と Mobile の `SessionPickerScreen` がそのデータを表示する。ラベルはクライアントサイドのストレージ（localStorage / AsyncStorage）に保存し、サーバーを経由しない。

**Tech Stack:** TypeScript, React (Desktop renderer), React Native + Expo (Mobile), vitest (Desktop tests), jest (Mobile tests), localStorage (Desktop labels), @react-native-async-storage/async-storage (Mobile labels)

---

## ファイルマップ

| ファイル | 変更内容 |
|--------|---------|
| `packages/shared/src/types.ts` | `SessionInfo` に `lastActiveAt?`, `lastOutputLine?`, `claudePhase?` を追加 |
| `packages/desktop/src/main/pty-server.ts` | `PtySession` に新フィールド追加、`updateSessionOutput` 追加、`getSessionInfos` 更新 |
| `packages/desktop/src/main/__tests__/pty-server.test.ts` | 新フィールドのテストを追加 |
| `packages/desktop/src/renderer/components/SessionList.tsx` | Rich Card UI に全面刷新、インラインラベル編集追加 |
| `packages/desktop/src/renderer/__tests__/SessionList.test.tsx` | 新しい表示仕様に合わせてテスト更新 |
| `packages/mobile/src/screens/SessionPickerScreen.tsx` | 拡張情報表示 + ラベル表示・編集 |

---

## Task 1: SessionInfo 型拡張（shared/types.ts）

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: `SessionInfo` に3フィールドを追加する**

`packages/shared/src/types.ts` の `SessionInfo` インターフェースを以下のように変更する：

```typescript
export interface SessionInfo {
  id: string
  createdAt: string
  status: 'active' | 'idle'
  clientIP?: string
  hasClient?: boolean
  isExternal?: boolean
  projectPath?: string
  source?: SessionSource
  /** PTYへの最終出力時刻 (ISO 8601) */
  lastActiveAt?: string
  /** PTYの最終出力行（ANSI除去済み、最大80文字） */
  lastOutputLine?: string
  /** Claudeの処理フェーズ推定 */
  claudePhase?: 'thinking' | 'writing' | 'waiting' | 'idle'
}
```

- [ ] **Step 2: shared のテストが通ることを確認する**

```bash
cd packages/shared && npx vitest run
```

Expected: PASS（型変更のみなので既存テストは通る）

- [ ] **Step 3: コミット**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): SessionInfo に lastActiveAt / lastOutputLine / claudePhase を追加"
```

---

## Task 2: pty-server — フェーズ検出と出力追跡

**Files:**
- Modify: `packages/desktop/src/main/pty-server.ts`
- Test: `packages/desktop/src/main/__tests__/pty-server.test.ts`

- [ ] **Step 1: テストを先に追加する（失敗を確認）**

`packages/desktop/src/main/__tests__/pty-server.test.ts` の末尾、既存の `describe` ブロックの外に以下を追加する：

```typescript
describe('session_list の claudePhase / lastOutputLine', () => {
  it('PTY 出力後に session_list_response の sessions[0].lastOutputLine が更新される', async () => {
    startPtyServer()
    const ws = createMockWs()
    wssState.instance!.emit('connection', ws)
    sendMessage(ws, { type: 'auth', token: 'test-token' })
    sendMessage(ws, { type: 'session_create' })
    ws.send.mockClear()

    // PTY が出力を生成
    ptyState.lastShell._onDataCb('Analyzing file.ts\n')

    sendMessage(ws, { type: 'session_list_request' })
    const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
    const response = calls.find((m: any) => m.type === 'session_list_response')
    expect(response.sessions[0].lastOutputLine).toBe('Analyzing file.ts')
  })

  it('スピナー文字を含む出力で claudePhase が "thinking" になる', () => {
    startPtyServer()
    const ws = createMockWs()
    wssState.instance!.emit('connection', ws)
    sendMessage(ws, { type: 'auth', token: 'test-token' })
    sendMessage(ws, { type: 'session_create' })
    ws.send.mockClear()

    ptyState.lastShell._onDataCb('⠋ Thinking...\n')

    sendMessage(ws, { type: 'session_list_request' })
    const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
    const response = calls.find((m: any) => m.type === 'session_list_response')
    expect(response.sessions[0].claudePhase).toBe('thinking')
  })

  it('"Writing" を含む出力で claudePhase が "writing" になる', () => {
    startPtyServer()
    const ws = createMockWs()
    wssState.instance!.emit('connection', ws)
    sendMessage(ws, { type: 'auth', token: 'test-token' })
    sendMessage(ws, { type: 'session_create' })
    ws.send.mockClear()

    ptyState.lastShell._onDataCb('Writing src/index.ts\n')

    sendMessage(ws, { type: 'session_list_request' })
    const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
    const response = calls.find((m: any) => m.type === 'session_list_response')
    expect(response.sessions[0].claudePhase).toBe('writing')
  })

  it('30秒経過後に claudePhase が "idle" になる', () => {
    vi.useFakeTimers()
    startPtyServer()
    const ws = createMockWs()
    wssState.instance!.emit('connection', ws)
    sendMessage(ws, { type: 'auth', token: 'test-token' })
    sendMessage(ws, { type: 'session_create' })

    ptyState.lastShell._onDataCb('⠋ Thinking...\n')
    vi.advanceTimersByTime(30000)

    sendMessage(ws, { type: 'session_list_request' })
    const calls = ws.send.mock.calls.map((c: any) => JSON.parse(c[0]))
    const response = calls.find((m: any) => m.type === 'session_list_response')
    expect(response.sessions[0].claudePhase).toBe('idle')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd packages/desktop && npx vitest run src/main/__tests__/pty-server.test.ts
```

Expected: 新規追加した4テストが FAIL（`lastOutputLine` / `claudePhase` が undefined）

- [ ] **Step 3: `pty-server.ts` に定数・型・ヘルパーを追加する**

`packages/desktop/src/main/pty-server.ts` で、既存の定数群（`IDLE_TIMEOUT` など）の直後に以下を追加する：

```typescript
// Claudeフェーズのアイドル判定時間（ms）
const CLAUDE_IDLE_TIMEOUT = 30000
```

`PtySession` インターフェースに以下のフィールドを追加する（`permissionBuffer` フィールドの直前）：

```typescript
  /** PTYへの最終出力時刻（ms） */
  lastOutputAt: number
  /** PTYの最終出力行（ANSI除去済み、最大80文字） */
  lastOutputLine?: string
  /** Claudeのフェーズ推定 */
  claudePhase?: 'thinking' | 'writing' | 'waiting' | 'idle'
  /** claudePhase を idle にするタイマー */
  claudeIdleTimeoutId: ReturnType<typeof setTimeout> | null
```

- [ ] **Step 4: `detectClaudePhase` 関数を追加する**

`pty-server.ts` の `detectAndSendPermission` 関数の直前に追加する：

```typescript
function detectClaudePhase(line: string): Exclude<SessionInfo['claudePhase'], 'idle' | undefined> | null {
  if (/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line)) return 'thinking'
  if (/Writing|Reading|Editing|Bash|Tool/i.test(line)) return 'writing'
  if (/\?$|\bEnter\b|\bpress\b|\bconfirm\b/i.test(line)) return 'waiting'
  return null
}
```

- [ ] **Step 5: `updateSessionOutput` 関数を追加する**

`detectClaudePhase` の直後に追加する：

```typescript
function updateSessionOutput(session: PtySession, data: string): void {
  const clean = stripAnsi(data)
  const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return

  session.lastOutputAt = Date.now()
  session.lastOutputLine = lines[lines.length - 1].slice(0, 80)

  const phase = detectClaudePhase(session.lastOutputLine)
  if (phase !== null) session.claudePhase = phase

  if (session.claudeIdleTimeoutId) clearTimeout(session.claudeIdleTimeoutId)
  session.claudeIdleTimeoutId = setTimeout(() => {
    const s = ptySessions.get(session.id)
    if (s) {
      s.claudePhase = 'idle'
      notifySessions()
    }
  }, CLAUDE_IDLE_TIMEOUT)

  notifySessions()
}
```

- [ ] **Step 6: `createPtySession` の PTY 出力ハンドラーに `updateSessionOutput` を呼ぶ**

`ptyProc.onData` のコールバック内、`appendScrollback` の直後に追加する：

```typescript
ptyProc.onData((data) => {
  appendScrollback(session, data)
  updateSessionOutput(session, data)   // ← 追加
  if (session.wsClient?.readyState === WebSocket.OPEN) {
    session.wsClient.send(JSON.stringify({ type: 'output', data } satisfies WsMessage))
  }
  serverCallbacks.onPtyOutput?.(id, data)
  detectAndSendPermission(session, data)
})
```

- [ ] **Step 7: 外部セッションの出力ハンドラーも更新する**

`isProvider && providerSessionId` ブロック内の `msg.type === 'output'` 処理で、`appendScrollback` の直後に同様に追加する：

```typescript
if (msg.type === 'output') {
  appendScrollback(provSession, msg.data)
  updateSessionOutput(provSession, msg.data)   // ← 追加
  if (provSession.wsClient?.readyState === WebSocket.OPEN) {
    provSession.wsClient.send(JSON.stringify({ type: 'output', data: msg.data } satisfies WsMessage))
  }
  serverCallbacks.onPtyOutput?.(providerSessionId, msg.data)
  setSessionActive(provSession)
  detectAndSendPermission(provSession, msg.data)
}
```

- [ ] **Step 8: `createPtySession` / `createExternalSession` の初期値を追加する**

`createPtySession` の `session` オブジェクト初期化に追加：

```typescript
const session: PtySession = {
  id,
  pty: ptyProc,
  providerWs: null,
  createdAt: new Date().toISOString(),
  status: 'active',
  scrollbackChunks: [],
  scrollbackLength: 0,
  wsClient: null,
  clientIP,
  idleTimeoutId: null,
  lastActiveAt: 0,
  lastOutputAt: 0,          // ← 追加
  claudeIdleTimeoutId: null, // ← 追加
  projectPath,
  source,
  permissionBuffer: '',
  pendingPermission: null,
  detachCleanupId: null,
}
```

`createExternalSession` の `session` オブジェクト初期化にも同様に追加：

```typescript
const session: PtySession = {
  id,
  pty: null,
  providerWs,
  createdAt: new Date().toISOString(),
  status: 'active',
  scrollbackChunks: [],
  scrollbackLength: 0,
  wsClient: null,
  idleTimeoutId: null,
  lastActiveAt: 0,
  lastOutputAt: 0,          // ← 追加
  claudeIdleTimeoutId: null, // ← 追加
  permissionBuffer: '',
  pendingPermission: null,
  detachCleanupId: null,
}
```

- [ ] **Step 9: `closeSession` で `claudeIdleTimeoutId` をクリアする**

`closeSession` 内の clearTimeout 群に追加する：

```typescript
function closeSession(session: PtySession, exitCode: number): void {
  if (session.idleTimeoutId) clearTimeout(session.idleTimeoutId)
  if (session.claudeIdleTimeoutId) clearTimeout(session.claudeIdleTimeoutId) // ← 追加
  if (session.pendingPermission) clearTimeout(session.pendingPermission.timeoutId)
  if (session.detachCleanupId) clearTimeout(session.detachCleanupId)
  // ... 以下変更なし
}
```

- [ ] **Step 10: `getSessionInfos` を更新して新フィールドを含める**

```typescript
function getSessionInfos(): SessionInfo[] {
  return Array.from(ptySessions.values()).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    status: s.status,
    clientIP: s.clientIP,
    hasClient: s.wsClient !== null && s.wsClient.readyState === WebSocket.OPEN,
    isExternal: s.pty === null,
    projectPath: s.projectPath,
    source: s.source,
    lastActiveAt: s.lastOutputAt > 0 ? new Date(s.lastOutputAt).toISOString() : undefined,
    lastOutputLine: s.lastOutputLine,
    claudePhase: s.claudePhase,
  }))
}
```

- [ ] **Step 11: テストが通ることを確認する**

```bash
cd packages/desktop && npx vitest run src/main/__tests__/pty-server.test.ts
```

Expected: 全テスト PASS

- [ ] **Step 12: コミット**

```bash
git add packages/desktop/src/main/pty-server.ts packages/desktop/src/main/__tests__/pty-server.test.ts
git commit -m "feat(desktop): pty-server に Claudeフェーズ検出と最終出力行追跡を追加"
```

---

## Task 3: Desktop SessionList — Rich Card UI

**Files:**
- Modify: `packages/desktop/src/renderer/components/SessionList.tsx`
- Modify: `packages/desktop/src/renderer/__tests__/SessionList.test.tsx`

- [ ] **Step 1: テストを新しい仕様に合わせて書き直す**

`packages/desktop/src/renderer/__tests__/SessionList.test.tsx` を以下に完全に置き換える：

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SessionInfo } from '@remocoder/shared'
import { SessionList } from '../components/SessionList'

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-001',
    createdAt: new Date(Date.now() - 23 * 60 * 1000).toISOString(), // 23分前
    status: 'active',
    hasClient: false,
    ...overrides,
  }
}

describe('SessionList', () => {
  describe('セッションが 0 件のとき', () => {
    it('接続待ち中メッセージを表示する', () => {
      render(<SessionList sessions={[]} />)
      expect(screen.getByText('Waiting for connections')).toBeInTheDocument()
    })

    it('カウントに — を表示する', () => {
      render(<SessionList sessions={[]} />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('セッションが複数あるとき', () => {
    const sessions = [
      makeSession({ id: 'sess-001', status: 'active', source: { kind: 'claude', projectPath: '/home/user/remocoder' } }),
      makeSession({ id: 'sess-002', status: 'idle',   source: { kind: 'shell' } }),
    ]

    it('件数を "N ACTIVE" 形式で表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('2 ACTIVE')).toBeInTheDocument()
    })

    it('active セッションに ACTIVE バッジを表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    })

    it('idle セッションに IDLE バッジを表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('IDLE')).toBeInTheDocument()
    })

    it('プロジェクト名を表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('remocoder')).toBeInTheDocument()
    })
  })

  describe('claudePhase 表示', () => {
    it('claudePhase が "thinking" のとき THINKING バッジを表示する', () => {
      render(<SessionList sessions={[makeSession({ claudePhase: 'thinking' })]} />)
      expect(screen.getByText('THINKING')).toBeInTheDocument()
    })

    it('claudePhase が "writing" のとき WRITING バッジを表示する', () => {
      render(<SessionList sessions={[makeSession({ claudePhase: 'writing' })]} />)
      expect(screen.getByText('WRITING')).toBeInTheDocument()
    })

    it('claudePhase が "idle" または未設定のときフェーズバッジを表示しない', () => {
      render(<SessionList sessions={[makeSession({ claudePhase: 'idle' })]} />)
      expect(screen.queryByText('THINKING')).not.toBeInTheDocument()
      expect(screen.queryByText('WRITING')).not.toBeInTheDocument()
      expect(screen.queryByText('WAITING')).not.toBeInTheDocument()
    })
  })

  describe('lastOutputLine 表示', () => {
    it('lastOutputLine があるとき出力プレビューを表示する', () => {
      render(<SessionList sessions={[makeSession({ lastOutputLine: 'Analyzing src/index.ts' })]} />)
      expect(screen.getByText('▸ Analyzing src/index.ts')).toBeInTheDocument()
    })

    it('lastOutputLine がないとき出力プレビューを表示しない', () => {
      render(<SessionList sessions={[makeSession({ lastOutputLine: undefined })]} />)
      expect(screen.queryByText(/▸/)).not.toBeInTheDocument()
    })
  })

  describe('elapsed time', () => {
    it('経過時間を表示する', () => {
      render(<SessionList sessions={[makeSession()]} />)
      expect(screen.getByText(/min ago/)).toBeInTheDocument()
    })
  })

  describe('セッションが 1 件のとき', () => {
    it('1 ACTIVE と表示する', () => {
      render(<SessionList sessions={[makeSession()]} />)
      expect(screen.getByText('1 ACTIVE')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd packages/desktop && npx vitest run src/renderer/__tests__/SessionList.test.tsx
```

Expected: 複数テストが FAIL（「remocoder」「THINKING」「▸ Analyzing...」などが見つからない）

- [ ] **Step 3: SessionList.tsx を Rich Card 仕様に全面書き換える**

`packages/desktop/src/renderer/components/SessionList.tsx` を以下に完全に置き換える：

```typescript
import React, { useState, useEffect } from 'react'
import type { SessionInfo, SessionSource, MultiplexerSessionInfo } from '@remocoder/shared'

interface SessionListProps {
  sessions: SessionInfo[]
  multiplexerSessions?: MultiplexerSessionInfo[]
  onOpenTerminal?: (sessionId: string) => void
  onNewSession?: () => void
  onAttachMultiplexer?: (tool: MultiplexerSessionInfo['tool'], sessionName: string) => void
  onRefreshMultiplexer?: () => void
}

// ── ヘルパー関数 ──────────────────────────────────────────────────────────────

function sourceIcon(source?: SessionSource): string {
  if (!source) return '🖥'
  switch (source.kind) {
    case 'claude': return '🤖'
    case 'shell':  return '🐚'
    case 'tmux':   return '📟'
    case 'screen': return '🖥'
    case 'zellij': return '🪟'
    default:       return '🖥'
  }
}

function resolveProjectName(session: SessionInfo): string | undefined {
  const path =
    (session.source?.kind === 'claude' ? session.source.projectPath : undefined) ??
    session.projectPath
  if (!path) return undefined
  return path.split('/').filter(Boolean).pop()
}

function formatElapsed(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h} hr ago`
}

function formatLastActive(isoString?: string): string | undefined {
  if (!isoString) return undefined
  const ms = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 5) return 'active just now'
  if (s < 60) return `active ${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `active ${m} min ago`
  return undefined // 1時間以上前は表示しない
}

function getLabelKey(sessionId: string): string {
  return `session-label-${sessionId}`
}

function loadLabel(sessionId: string): string {
  try {
    return localStorage.getItem(getLabelKey(sessionId)) ?? ''
  } catch {
    return ''
  }
}

function saveLabel(sessionId: string, label: string): void {
  try {
    if (label.trim()) {
      localStorage.setItem(getLabelKey(sessionId), label.trim())
    } else {
      localStorage.removeItem(getLabelKey(sessionId))
    }
  } catch {
    // localStorage 不使用環境（テスト等）では無視
  }
}

// ── SessionRow ───────────────────────────────────────────────────────────────

function SessionRow({
  session,
  index,
  onOpen,
}: {
  session: SessionInfo
  index: number
  onOpen?: (id: string) => void
}) {
  const isActive = session.status === 'active'
  const hasClient = session.hasClient ?? false
  const isThinking = session.claudePhase === 'thinking' || session.claudePhase === 'writing'

  const [isEditing, setIsEditing] = useState(false)
  const [labelValue, setLabelValue] = useState(() => loadLabel(session.id))

  const projectName = resolveProjectName(session)
  const displayName = labelValue || projectName || session.clientIP || `client_${session.id.slice(0, 6)}`

  const handleLabelBlur = () => {
    saveLabel(session.id, labelValue)
    setIsEditing(false)
  }

  const handleLabelKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      saveLabel(session.id, labelValue)
      setIsEditing(false)
    }
    if (e.key === 'Escape') {
      setLabelValue(loadLabel(session.id))
      setIsEditing(false)
    }
  }

  const phaseLabel = (() => {
    switch (session.claudePhase) {
      case 'thinking': return 'THINKING'
      case 'writing':  return 'WRITING'
      case 'waiting':  return 'WAITING'
      default:         return null
    }
  })()

  const phaseColor = (() => {
    switch (session.claudePhase) {
      case 'thinking': return 'var(--blue, #60a5fa)'
      case 'writing':  return 'var(--green)'
      case 'waiting':  return 'var(--amber)'
      default:         return undefined
    }
  })()

  const lastActiveText = formatLastActive(session.lastActiveAt)
  const metaParts = [
    session.isExternal ? 'EXTERNAL' : session.clientIP,
    formatElapsed(session.createdAt),
    lastActiveText,
  ].filter(Boolean)

  return (
    <div style={{ ...styles.card, animationDelay: `${index * 0.06}s` }}>
      {/* ヘッダー行 */}
      <div style={styles.cardHeader}>
        <div style={styles.cardLeft}>
          <span
            style={{
              ...styles.dot,
              backgroundColor: isActive ? 'var(--green)' : 'var(--amber)',
              boxShadow: isActive ? '0 0 5px var(--green)' : '0 0 4px var(--amber)',
              animation: isActive
                ? 'pulse-green 2s ease-in-out infinite'
                : 'pulse-amber 1.8s ease-in-out infinite',
            }}
          />
          <span style={styles.icon}>{sourceIcon(session.source)}</span>
          {isEditing ? (
            <input
              style={styles.labelInput}
              value={labelValue}
              autoFocus
              onChange={(e) => setLabelValue(e.target.value)}
              onBlur={handleLabelBlur}
              onKeyDown={handleLabelKeyDown}
              placeholder={projectName ?? 'Session name'}
            />
          ) : (
            <span
              style={styles.labelText}
              title="Click to rename"
              onClick={() => setIsEditing(true)}
            >
              {displayName}
              <span style={styles.editHint}>✎</span>
            </span>
          )}
        </div>
        <div style={styles.cardRight}>
          {phaseLabel && (
            <span style={{ ...styles.phaseBadge, color: phaseColor, borderColor: phaseColor }}>
              {phaseLabel}
            </span>
          )}
          <span
            style={{
              ...styles.statusBadge,
              color: isActive ? 'var(--green)' : 'var(--amber)',
              borderColor: isActive ? 'var(--green-dim)' : 'var(--amber-dim)',
              background: isActive ? 'var(--green-pulse)' : 'var(--amber-glow)',
            }}
          >
            {session.status.toUpperCase()}
            {hasClient ? ' · Connected' : ''}
          </span>
          {onOpen && (
            <button style={styles.openButton} onClick={() => onOpen(session.id)} title="Open terminal">
              <TerminalIcon />
            </button>
          )}
        </div>
      </div>

      {/* メタ情報行 */}
      {metaParts.length > 0 && (
        <div style={styles.cardMeta}>
          {metaParts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={styles.metaSep}>·</span>}
              <span style={styles.metaText}>{part}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* アクティビティバー */}
      {isThinking && <div style={styles.activityBar} />}

      {/* 最終出力プレビュー */}
      {session.lastOutputLine && (
        <div style={styles.outputPreview}>▸ {session.lastOutputLine}</div>
      )}
    </div>
  )
}

// ── MultiplexerRow（変更なし） ────────────────────────────────────────────────

function toolLabel(tool: MultiplexerSessionInfo['tool']): string {
  return tool.toUpperCase()
}

function MultiplexerRow({
  info,
  index,
  onAttach,
}: {
  info: MultiplexerSessionInfo
  index: number
  onAttach?: (tool: MultiplexerSessionInfo['tool'], sessionName: string) => void
}) {
  return (
    <div style={{ ...styles.card, animationDelay: `${index * 0.06}s` }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardLeft}>
          <span style={{ ...styles.statusBadge, color: 'var(--amber)', borderColor: 'var(--amber-dim)', background: 'var(--amber-glow)' }}>
            {toolLabel(info.tool)}
          </span>
          <span style={styles.labelText}>{info.sessionName}</span>
        </div>
        <div style={styles.cardRight}>
          {onAttach && (
            <button style={styles.openButton} onClick={() => onAttach(info.tool, info.sessionName)} title="Attach">
              <AttachIcon />
            </button>
          )}
        </div>
      </div>
      {(info.detail || info.workingDirectory) && (
        <div style={styles.cardMeta}>
          {info.detail && <span style={styles.metaText}>{info.detail}</span>}
          {info.workingDirectory && (
            <>
              {info.detail && <span style={styles.metaSep}>·</span>}
              <span style={{ ...styles.metaText, fontFamily: 'monospace' }} title={info.workingDirectory}>
                {info.workingDirectory}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── SessionList ───────────────────────────────────────────────────────────────

export function SessionList({
  sessions,
  multiplexerSessions,
  onOpenTerminal,
  onNewSession,
  onAttachMultiplexer,
  onRefreshMultiplexer,
}: SessionListProps) {
  const hasMux = multiplexerSessions && multiplexerSessions.length > 0

  return (
    <>
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionLabel}>CONNECTIONS</span>
          <div style={styles.headerLine} />
          <span style={styles.count}>
            {sessions.length > 0 ? `${sessions.length} ACTIVE` : '—'}
          </span>
          {onNewSession && (
            <button style={styles.newButton} onClick={onNewSession} title="Create new session">
              <PlusIcon />
            </button>
          )}
        </div>

        {sessions.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}><WifiIcon /></div>
            <p style={styles.emptyText}>Waiting for connections</p>
            <p style={styles.emptySubText}>
              <span style={{ color: 'var(--green)', animation: 'blink 1.2s step-end infinite' }}>▮</span>
              {' '}Waiting for connection from mobile app
            </p>
            {onNewSession && (
              <button style={styles.newSessionBtn} onClick={onNewSession}>
                + Create new session
              </button>
            )}
          </div>
        ) : (
          <div style={styles.list}>
            {sessions.map((s, i) => (
              <SessionRow key={s.id} session={s} index={i} onOpen={onOpenTerminal} />
            ))}
          </div>
        )}
      </section>

      {multiplexerSessions !== undefined && (
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>MULTIPLEXERS</span>
            <div style={styles.headerLine} />
            <span style={{ ...styles.count, color: hasMux ? 'var(--amber)' : 'var(--text-dim)' }}>
              {hasMux ? `${multiplexerSessions.length} FOUND` : '—'}
            </span>
            {onRefreshMultiplexer && (
              <button style={styles.newButton} onClick={onRefreshMultiplexer} title="Refresh list">
                <RefreshIcon />
              </button>
            )}
          </div>

          {!hasMux ? (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No sessions</p>
              <p style={styles.emptySubText}>No tmux / screen / zellij sessions found</p>
            </div>
          ) : (
            <div style={styles.list}>
              {multiplexerSessions.map((m, i) => (
                <MultiplexerRow
                  key={`${m.tool}:${m.sessionName}`}
                  info={m}
                  index={i}
                  onAttach={onAttachMultiplexer}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}

// ── アイコン ─────────────────────────────────────────────────────────────────

function TerminalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function AttachIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}
function RefreshIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}
function WifiIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 12.55a11 11 0 0114.08 0"/>
      <path d="M1.42 9a16 16 0 0121.16 0"/>
      <path d="M8.53 16.11a6 6 0 016.95 0"/>
      <circle cx="12" cy="20" r="1" fill="currentColor"/>
    </svg>
  )
}

// ── スタイル ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  section: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    animation: 'fade-in 0.4s ease forwards',
    animationDelay: '0.1s',
    opacity: 0,
  },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--text-muted)', whiteSpace: 'nowrap',
  },
  headerLine: { flex: 1, height: 1, background: 'var(--border)' },
  count: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--green)', whiteSpace: 'nowrap',
  },
  newButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 20, height: 20,
    background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)', color: 'var(--green)', cursor: 'pointer', padding: 0,
  },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 0', color: 'var(--text-muted)',
  },
  emptyIcon: { color: 'var(--text-dim)', marginBottom: 4 },
  emptyText: { fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', letterSpacing: '0.05em' },
  emptySubText: { fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.05em', textAlign: 'center' },
  newSessionBtn: {
    marginTop: 8, padding: '5px 12px',
    background: 'var(--bg-elevated)', border: '1px solid var(--green-dim)',
    borderRadius: 'var(--radius)', color: 'var(--green)', fontSize: 10, cursor: 'pointer', letterSpacing: '0.05em',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  card: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', overflow: 'hidden',
    animation: 'slide-in 0.25s ease forwards', opacity: 0,
  },
  cardHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 10px', gap: 6,
  },
  cardLeft: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 },
  cardRight: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 },
  dot: { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  icon: { fontSize: 12, flexShrink: 0 },
  labelText: {
    fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em',
    cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    display: 'flex', alignItems: 'center', gap: 3,
  },
  editHint: { fontSize: 8, color: 'var(--text-dim)', opacity: 0.6 },
  labelInput: {
    fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em',
    background: 'var(--bg-base)', border: '1px solid var(--green-dim)',
    borderRadius: 2, padding: '1px 4px', outline: 'none', minWidth: 0, flex: 1,
  },
  cardMeta: {
    display: 'flex', alignItems: 'center', gap: 4,
    paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap',
  },
  metaText: { fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.03em' },
  metaSep: { fontSize: 8, color: 'var(--text-dim)' },
  statusBadge: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
    padding: '2px 6px', border: '1px solid', borderRadius: 2, whiteSpace: 'nowrap', flexShrink: 0,
  },
  phaseBadge: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
    padding: '2px 6px', border: '1px solid', borderRadius: 2, whiteSpace: 'nowrap', flexShrink: 0,
    background: 'transparent',
  },
  activityBar: {
    height: 2,
    background: 'linear-gradient(90deg, transparent, var(--green) 50%, transparent)',
    backgroundSize: '200% 100%',
    animation: 'activity-scan 1.5s linear infinite',
  },
  outputPreview: {
    padding: '4px 10px', fontSize: 8, color: 'var(--green)',
    background: 'var(--bg-base)', borderTop: '1px solid var(--border)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    letterSpacing: '0.03em', fontFamily: 'monospace',
  },
  openButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, background: 'var(--bg-base)',
    border: '1px solid var(--border-bright)', borderRadius: 'var(--radius)',
    color: 'var(--green)', cursor: 'pointer', padding: 0, flexShrink: 0,
  },
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
cd packages/desktop && npx vitest run src/renderer/__tests__/SessionList.test.tsx
```

Expected: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add packages/desktop/src/renderer/components/SessionList.tsx \
        packages/desktop/src/renderer/__tests__/SessionList.test.tsx
git commit -m "feat(desktop): SessionList を Rich Card 形式に刷新（フェーズ表示・出力プレビュー・インラインラベル編集）"
```

---

## Task 4: Mobile SessionPickerScreen — 拡張情報表示とラベル機能

**Files:**
- Modify: `packages/mobile/src/screens/SessionPickerScreen.tsx`

- [ ] **Step 1: AsyncStorage のインポートを確認する**

`packages/mobile/src/screens/SessionPickerScreen.tsx` の先頭インポートに `AsyncStorage` が含まれていることを確認する。なければ追加する：

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage'
```

- [ ] **Step 2: ヘルパー関数とラベル管理フックを追加する**

`SessionPickerScreen.tsx` のインポートブロック直後（`type ListItem = ...` の前）に追加する：

```typescript
// ── モバイル用ヘルパー ──────────────────────────────────────────────────────

function mobileSourceIcon(source?: SessionSource): string {
  if (!source) return '🖥'
  switch (source.kind) {
    case 'claude': return '🤖'
    case 'shell':  return '🐚'
    case 'tmux':   return '📟'
    case 'screen': return '🖥'
    case 'zellij': return '🪟'
    default:       return '🖥'
  }
}

function mobileProjectName(session: SessionInfo): string | undefined {
  const path =
    (session.source?.kind === 'claude' ? session.source.projectPath : undefined) ??
    session.projectPath
  if (!path) return undefined
  return path.split('/').filter(Boolean).pop()
}

function mobileFormatElapsed(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h} hr ago`
}

function mobilePhaseBadgeText(phase?: SessionInfo['claudePhase']): string | null {
  switch (phase) {
    case 'thinking': return '✦ THINKING'
    case 'writing':  return '✦ WRITING'
    case 'waiting':  return '? WAITING'
    default:         return null
  }
}

const LABEL_KEY_PREFIX = 'session-label-'

function useMobileLabels(sessionIds: string[]) {
  const [labels, setLabels] = React.useState<Record<string, string>>({})

  useEffect(() => {
    if (sessionIds.length === 0) return
    const keys = sessionIds.map((id) => LABEL_KEY_PREFIX + id)
    AsyncStorage.multiGet(keys).then((pairs) => {
      const map: Record<string, string> = {}
      pairs.forEach(([key, value]) => {
        if (value) map[key.replace(LABEL_KEY_PREFIX, '')] = value
      })
      setLabels(map)
    })
  }, [sessionIds.join(',')])

  const setLabel = async (sessionId: string, label: string) => {
    if (label.trim()) {
      await AsyncStorage.setItem(LABEL_KEY_PREFIX + sessionId, label.trim())
      setLabels((prev) => ({ ...prev, [sessionId]: label.trim() }))
    } else {
      await AsyncStorage.removeItem(LABEL_KEY_PREFIX + sessionId)
      setLabels((prev) => { const next = { ...prev }; delete next[sessionId]; return next })
    }
  }

  return { labels, setLabel }
}
```

- [ ] **Step 3: `RenameModal` コンポーネントを追加する**

`useMobileLabels` の直後に追加する：

```typescript
function RenameModal({
  visible,
  initialValue,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  initialValue: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = React.useState(initialValue)

  useEffect(() => {
    if (visible) setValue(initialValue)
  }, [visible, initialValue])

  if (!visible) return null

  return (
    <View style={renameStyles.overlay}>
      <View style={renameStyles.modal}>
        <Text style={renameStyles.title}>Rename Session</Text>
        <TextInput
          style={renameStyles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Session name"
          placeholderTextColor="#8b949e"
          autoFocus
          selectTextOnFocus
        />
        <View style={renameStyles.buttons}>
          <TouchableOpacity style={renameStyles.cancelBtn} onPress={onCancel}>
            <Text style={renameStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={renameStyles.confirmBtn} onPress={() => onConfirm(value)}>
            <Text style={renameStyles.confirmText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const renameStyles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    backgroundColor: '#161b22', borderRadius: 12, padding: 20,
    width: '80%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    gap: 14,
  },
  title: { color: '#c9d1d9', fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: '#0d1117', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: '#c9d1d9', fontSize: 14,
  },
  buttons: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' },
  cancelText: { color: '#8b949e', fontSize: 14 },
  confirmBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: 'rgba(78,201,176,0.15)', borderWidth: 1, borderColor: 'rgba(78,201,176,0.3)' },
  confirmText: { color: '#4ec9b0', fontSize: 14, fontWeight: '600' },
})
```

- [ ] **Step 4: `SessionPickerScreen` に `useMobileLabels` とリネームモーダル状態を追加する**

`SessionPickerScreen` 関数内の `const { connectionStatus, sessions, ... } = useSessionPickerWs(...)` の直後に追加する：

```typescript
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions])
  const { labels, setLabel } = useMobileLabels(sessionIds)

  const [renameTarget, setRenameTarget] = React.useState<{ id: string; current: string } | null>(null)
```

- [ ] **Step 5: `handleDeleteSession` を更新してリネームオプションを追加する**

既存の `handleDeleteSession` を以下に置き換える：

```typescript
  const handleLongPressSession = useCallback(
    (session: SessionInfo) => {
      if (isDeletingSession) return
      const name = labels[session.id] || getSessionDisplayName(session)
      Alert.alert(
        name,
        'Choose an action',
        [
          {
            text: 'Rename',
            onPress: () => setRenameTarget({ id: session.id, current: labels[session.id] ?? '' }),
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Delete Session',
                `Terminate and delete "${name}"?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteSession(session.id) },
                ],
              )
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      )
    },
    [isDeletingSession, labels, deleteSession],
  )
```

- [ ] **Step 6: `item.kind === 'session'` のレンダリング部分を更新する**

`renderItem` 内の `if (item.kind === 'session')` ブロックを以下に置き換える：

```typescript
            if (item.kind === 'session') {
              const { session } = item
              const label = labels[session.id]
              const projectName = mobileProjectName(session)
              const displayName = label || projectName || getSessionDisplayName(session)
              const icon = mobileSourceIcon(session.source)
              const phaseBadge = mobilePhaseBadgeText(session.claudePhase)
              const isDeleting = isDeletingSession && deletingSessionId === session.id
              return (
                <TouchableOpacity
                  style={[styles.sessionRow, isDeleting && styles.sessionRowDeleting]}
                  onPress={() => !isDeleting && handleAttachSession(session.id)}
                  onLongPress={() => !isDeleting && handleLongPressSession(session)}
                  delayLongPress={500}
                >
                  <View
                    style={[
                      styles.statusDot,
                      session.status === 'active' ? styles.dotActive : styles.dotIdle,
                    ]}
                  />
                  <View style={styles.sessionInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={styles.sessionName}>{icon} {displayName}</Text>
                      {phaseBadge && (
                        <Text style={mobileSessionStyles.phaseBadge}>{phaseBadge}</Text>
                      )}
                    </View>
                    <Text style={styles.sessionMeta}>
                      {session.status === 'active' ? 'Active' : 'Idle'}
                      {session.hasClient ? ' · Connected' : ''}
                      {' · '}{mobileFormatElapsed(session.createdAt)}
                    </Text>
                    {session.lastOutputLine && (
                      <Text style={mobileSessionStyles.outputPreview} numberOfLines={1}>
                        ▸ {session.lastOutputLine}
                      </Text>
                    )}
                  </View>
                  {isDeleting
                    ? <ActivityIndicator size="small" color="#f85149" />
                    : <Text style={styles.attachArrow}>→</Text>
                  }
                </TouchableOpacity>
              )
            }
```

- [ ] **Step 7: `mobileSessionStyles` を追加する**

ファイル末尾の `const styles = StyleSheet.create({...})` の後に追加する：

```typescript
const mobileSessionStyles = StyleSheet.create({
  phaseBadge: {
    color: '#60a5fa',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  outputPreview: {
    color: '#4ec9b0',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
})
```

- [ ] **Step 8: `RenameModal` を `SafeAreaView` 内に追加する**

`SessionPickerScreen` の `return` 内、`</SafeAreaView>` の直前に追加する：

```typescript
      <RenameModal
        visible={renameTarget !== null}
        initialValue={renameTarget?.current ?? ''}
        onConfirm={(value) => {
          if (renameTarget) setLabel(renameTarget.id, value)
          setRenameTarget(null)
        }}
        onCancel={() => setRenameTarget(null)}
      />
```

- [ ] **Step 9: 型エラーがないことを確認する**

```bash
cd packages/mobile && npx tsc --noEmit
```

Expected: エラーなし（または既存の型エラーのみ）

- [ ] **Step 10: コミット**

```bash
git add packages/mobile/src/screens/SessionPickerScreen.tsx
git commit -m "feat(mobile): SessionPickerScreen に拡張情報表示・ラベル機能・リネームモーダルを追加"
```

---

## 最終確認

- [ ] **全テストが通ることを確認する**

```bash
cd packages/desktop && npx vitest run
cd packages/mobile && npx jest --passWithNoTests
```

Expected: 全テスト PASS

- [ ] **デスクトップアプリで動作確認する**

```bash
cd packages/desktop && npm run dev
```

確認項目:
- セッション一覧にプロジェクト名・絵文字アイコンが表示される
- 経過時間が「N min ago」形式で表示される
- PTY出力後に最終出力行プレビューが表示される
- `claudePhase` バッジ（THINKING/WRITING/WAITING）が表示される
- セッション名をクリックするとインライン編集できる
- 編集したラベルが再起動後も保持される

- [ ] **最終コミット（必要であれば）**

```bash
git add -A
git commit -m "chore: session list rich card 実装完了"
```
