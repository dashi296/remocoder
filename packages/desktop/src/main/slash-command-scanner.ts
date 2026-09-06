/**
 * Claude Code のスラッシュコマンド（コマンド定義とスキル）を走査して一覧化する。
 *
 * 依存を増やさないため glob ライブラリは使わず Node の fs API のみで実装する。
 */

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
