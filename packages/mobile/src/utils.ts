import type { SessionInfo } from '@remocoder/shared'

/** ISO日付文字列を日本語表示用の短い形式にフォーマットする */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** セッションの表示名を返す（projectPath のベース名、なければ 'セッション'） */
export function getSessionDisplayName(session: Pick<SessionInfo, 'projectPath'>): string {
  return session.projectPath
    ? (session.projectPath.split('/').filter(Boolean).pop() ?? 'セッション')
    : 'セッション'
}
