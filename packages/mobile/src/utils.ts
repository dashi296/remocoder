import type { SessionInfo } from '@remocoder/shared'

export const PROFILES_KEY = 'connectionProfiles'

export interface ConnectionProfile {
  id: string
  name: string
  ip: string
  token: string
  lastConnectedAt?: string
}

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

/** useLocalSearchParams の値は string | string[] になりうるため先頭要素を返す */
export function firstParam(v: string | string[]): string
export function firstParam(v: string | string[] | undefined): string | undefined
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** セッションの表示名を返す（projectPath のベース名、なければ 'セッション'） */
export function getSessionDisplayName(session: Pick<SessionInfo, 'projectPath'>): string {
  return session.projectPath
    ? (session.projectPath.split('/').filter(Boolean).pop() ?? 'セッション')
    : 'セッション'
}
