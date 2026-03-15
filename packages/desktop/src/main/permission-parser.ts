export interface ParsedPermission {
  toolName: string
  details: string[]
  requiresAlways: boolean
  /** レスポンス送信形式: 'numbered' = 1/2/3キー, 'legacy' = y/n/aキー */
  style: 'numbered' | 'legacy'
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[?>=!]*[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]/g, '')
}

// ── 新形式: 番号付きメニュー（Claude Code 現行版） ───────────────────────────
// "Do you want to proceed?\n   1. Yes\n   2. Yes, and don't ask again..."
// ❯ カーソルが 1. の前に付く場合も考慮: " ❯ 1. Yes"
const NUMBERED_PROMPT_RE = /Do you want to proceed\?[\r\n]+[^\r\n]*1\.\s+Yes/m
const ALWAYS_OPTION_RE = /don't ask again for:/m
// "─── Bash command" or "Bash command" の形式からツール名を抽出
const NUMBERED_TOOL_RE = /(?:─+\s+)?([A-Za-z][A-Za-z0-9_]*)\s+command\s*[\r\n]/m
const NUMBERED_DETAIL_RE = /command\s*[\r\n]+[\r\n]+([ \t]+\S[^\r\n]*)/m

// ── 旧形式: ボックス + [y/n/a] ───────────────────────────────────────────────
const TOOL_BOX_HEADER_RE = /╭─\s+(.+?)\s+─+╮/
const TOOL_BOX_CONTENT_RE = /│\s+(?:\$\s+)?(.+?)\s*│/g
// [y/n/a] or [y/n/a/?] (? = help option in newer Claude Code)
const PERMISSION_PROMPT_RE = /Allow\?\s+\[y\/n\/a[^\]]*\].*:\s*$/m
const YN_PROMPT_RE = /Do you want to proceed\?\s+\[y\/n\]:\s*$/m

export function tryParsePermission(buf: string): ParsedPermission | null {
  const clean = stripAnsi(buf)

  // ── 番号付きメニュー形式を優先検出 ─────────────────────────────────────
  if (NUMBERED_PROMPT_RE.test(clean)) {
    const requiresAlways = ALWAYS_OPTION_RE.test(clean)

    const toolMatch = NUMBERED_TOOL_RE.exec(clean)
    const toolName = toolMatch ? toolMatch[1].trim() : 'Unknown'

    const details: string[] = []
    const detailMatch = NUMBERED_DETAIL_RE.exec(clean)
    if (detailMatch) {
      const line = detailMatch[1].trim()
      if (line) details.push(line)
    }

    return { toolName, details, requiresAlways, style: 'numbered' }
  }

  // ── 旧形式（ボックス + [y/n/a]） ───────────────────────────────────────
  const isAlways = PERMISSION_PROMPT_RE.test(clean)
  const isYN = YN_PROMPT_RE.test(clean)
  if (!isAlways && !isYN) return null

  const toolMatch = TOOL_BOX_HEADER_RE.exec(clean)
  const toolName = toolMatch ? toolMatch[1].trim() : 'Unknown'

  const details: string[] = []
  const contentRe = new RegExp(TOOL_BOX_CONTENT_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = contentRe.exec(clean)) !== null) {
    const line = m[1].trim()
    if (line) details.push(line)
  }

  return { toolName, details, requiresAlways: isAlways, style: 'legacy' }
}
