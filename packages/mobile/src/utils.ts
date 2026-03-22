import type { SessionInfo } from '@remocoder/shared'

export const PROFILES_KEY = 'connectionProfiles'

export interface ConnectionProfile {
  id: string
  name: string
  ip: string
  token: string
  lastConnectedAt?: string
}

/** Format an ISO date string into a short display format */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
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

/** Return a display name for the session (basename of projectPath, or 'Session' if absent) */
export function getSessionDisplayName(session: Pick<SessionInfo, 'projectPath'>): string {
  return session.projectPath
    ? (session.projectPath.split('/').filter(Boolean).pop() ?? 'Session')
    : 'Session'
}
