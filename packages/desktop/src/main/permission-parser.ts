export interface ParsedPermission {
  toolName: string
  details: string[]
  requiresAlways: boolean
}

// ANSI エスケープシーケンス除去パターン
const ANSI_RE = /\x1b\[[?>=!]*[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

// Claude Code 承認プロンプト検出パターン
const TOOL_BOX_HEADER_RE = /╭─\s+(.+?)\s+─+╮/
const TOOL_BOX_CONTENT_RE = /│\s+(?:\$\s+)?(.+?)\s*│/g
const PERMISSION_PROMPT_RE = /Allow\?\s+\[y\/n\/a\].*:\s*$/m
const YN_PROMPT_RE = /Do you want to proceed\?\s+\[y\/n\]:\s*$/m

export function tryParsePermission(buf: string): ParsedPermission | null {
  const clean = stripAnsi(buf)
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

  return { toolName, details, requiresAlways: isAlways }
}
