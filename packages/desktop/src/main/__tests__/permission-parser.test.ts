import { describe, it, expect } from 'vitest'
import { tryParsePermission, stripAnsi } from '../permission-parser'

describe('stripAnsi', () => {
  it('removes CSI sequences', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello')
  })

  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text')
  })

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text')
  })
})

describe('tryParsePermission', () => {
  // ── 旧形式（ボックス + [y/n/a]） ──────────────────────────────────────────
  const BASH_PROMPT = `
╭─ BashTool ────────────────────────────────────────────────────────╮
│ $ npm test                                                         │
╰────────────────────────────────────────────────────────────────────╯
Allow? [y/n/a]: `

  const WRITE_PROMPT = `
╭─ Write ────────────────────────────────────────────────────────────╮
│ /Users/user/project/src/index.ts                                   │
╰────────────────────────────────────────────────────────────────────╯
Do you want to proceed? [y/n]: `

  // ── 新形式（番号付きメニュー） ─────────────────────────────────────────────
  // 実機ログから確認した実際の形式: 行頭に ─ 記号が続く
  const NUMBERED_BASH_PROMPT = `
────────────────────────────────────────────────── Bash command

   cd /Users/shunokada/projects/remocoder/packages/desktop && npm test

 Do you want to proceed?
   1. Yes
 ❯ 2. Yes, and don't ask again for: cd:*
   3. No

 Esc to cancel ·`

  const NUMBERED_NO_ALWAYS_PROMPT = `
Write command

   /Users/user/project/src/index.ts

 Do you want to proceed?
   1. Yes
   2. No

 Esc to cancel ·`

  it('returns null for regular output', () => {
    expect(tryParsePermission('Hello, world!\nSome output here.')).toBeNull()
  })

  // ── 旧形式テスト ───────────────────────────────────────────────────────────
  it('(legacy) detects [y/n/a] prompt with requiresAlways=true', () => {
    const result = tryParsePermission(BASH_PROMPT)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('BashTool')
    expect(result!.details).toContain('npm test')
    expect(result!.requiresAlways).toBe(true)
    expect(result!.style).toBe('legacy')
  })

  it('(legacy) detects [y/n] prompt with requiresAlways=false', () => {
    const result = tryParsePermission(WRITE_PROMPT)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Write')
    expect(result!.requiresAlways).toBe(false)
    expect(result!.style).toBe('legacy')
  })

  it('(legacy) detects prompt with ANSI escape codes mixed in', () => {
    const withAnsi = BASH_PROMPT
      .replace('BashTool', '\x1b[1mBashTool\x1b[0m')
      .replace('npm test', '\x1b[33mnpm test\x1b[0m')
    const result = tryParsePermission(withAnsi)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('BashTool')
    expect(result!.requiresAlways).toBe(true)
    expect(result!.style).toBe('legacy')
  })

  it('(legacy) returns null if prompt not at end of buffer (split chunks)', () => {
    const partial = `
╭─ BashTool ─╮
│ $ npm test │
╰────────────╯`
    expect(tryParsePermission(partial)).toBeNull()
  })

  it('(legacy) handles Unknown toolName when header is absent', () => {
    const noHeader = 'Allow? [y/n/a]: '
    const result = tryParsePermission(noHeader)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Unknown')
    expect(result!.details).toHaveLength(0)
    expect(result!.requiresAlways).toBe(true)
    expect(result!.style).toBe('legacy')
  })

  it('(legacy) collects multiple detail lines', () => {
    const multi = `
╭─ MultiTool ──────────────────────────────────────────────────────╮
│ file1.ts                                                          │
│ file2.ts                                                          │
╰───────────────────────────────────────────────────────────────────╯
Allow? [y/n/a]: `
    const result = tryParsePermission(multi)
    expect(result).not.toBeNull()
    expect(result!.details).toContain('file1.ts')
    expect(result!.details).toContain('file2.ts')
  })

  // ── 新形式テスト ───────────────────────────────────────────────────────────
  it('(numbered) detects prompt with requiresAlways=true when "don\'t ask again" option present', () => {
    const result = tryParsePermission(NUMBERED_BASH_PROMPT)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Bash')
    expect(result!.requiresAlways).toBe(true)
    expect(result!.style).toBe('numbered')
  })

  it('(numbered) extracts command detail', () => {
    const result = tryParsePermission(NUMBERED_BASH_PROMPT)
    expect(result).not.toBeNull()
    expect(result!.details.length).toBeGreaterThan(0)
    expect(result!.details[0]).toContain('remocoder')
  })

  it('(numbered) detects prompt with requiresAlways=false when no "don\'t ask again"', () => {
    const result = tryParsePermission(NUMBERED_NO_ALWAYS_PROMPT)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Write')
    expect(result!.requiresAlways).toBe(false)
    expect(result!.style).toBe('numbered')
  })

  it('(numbered) detects with CRLF line endings (PTY output)', () => {
    const withCrlf = NUMBERED_BASH_PROMPT.replace(/\n/g, '\r\n')
    const result = tryParsePermission(withCrlf)
    expect(result).not.toBeNull()
    expect(result!.style).toBe('numbered')
  })

  // 実機ログから確認: ❯ カーソルが選択肢 1 の前に付く形式
  it('(numbered) detects when ❯ cursor is before option 1', () => {
    const withCursor = `
────────────────────────────────────────────────── Bash command

   ls -la /Users/user

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for: Bash
   3. No

 Esc to cancel ·`
    const result = tryParsePermission(withCursor)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Bash')
    expect(result!.requiresAlways).toBe(true)
    expect(result!.style).toBe('numbered')
  })
})
