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

  it('returns null for regular output', () => {
    expect(tryParsePermission('Hello, world!\nSome output here.')).toBeNull()
  })

  it('detects [y/n/a] prompt with requiresAlways=true', () => {
    const result = tryParsePermission(BASH_PROMPT)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('BashTool')
    expect(result!.details).toContain('npm test')
    expect(result!.requiresAlways).toBe(true)
  })

  it('detects [y/n] prompt with requiresAlways=false', () => {
    const result = tryParsePermission(WRITE_PROMPT)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Write')
    expect(result!.requiresAlways).toBe(false)
  })

  it('detects prompt with ANSI escape codes mixed in', () => {
    const withAnsi = BASH_PROMPT
      .replace('BashTool', '\x1b[1mBashTool\x1b[0m')
      .replace('npm test', '\x1b[33mnpm test\x1b[0m')
    const result = tryParsePermission(withAnsi)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('BashTool')
    expect(result!.requiresAlways).toBe(true)
  })

  it('returns null if prompt not at end of buffer (split chunks)', () => {
    // Only the header without the trailing prompt line
    const partial = `
╭─ BashTool ─╮
│ $ npm test │
╰────────────╯`
    expect(tryParsePermission(partial)).toBeNull()
  })

  it('handles Unknown toolName when header is absent', () => {
    const noHeader = 'Allow? [y/n/a]: '
    const result = tryParsePermission(noHeader)
    expect(result).not.toBeNull()
    expect(result!.toolName).toBe('Unknown')
    expect(result!.details).toHaveLength(0)
    expect(result!.requiresAlways).toBe(true)
  })

  it('collects multiple detail lines', () => {
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
})
