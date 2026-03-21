import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  DEFAULT_WS_PORT,
  MultiplexerSessionInfo,
  ProjectInfo,
  SessionInfo,
  WsMessage,
} from '@remocoder/shared'
import { ConnectionProfile, PROFILES_KEY } from '../utils'

export type ConnectionStatus = 'connecting' | 'connected' | 'error'

interface SessionsData {
  sessions: SessionInfo[]
  multiplexerSessions: MultiplexerSessionInfo[]
}

export const sessionPickerKeys = {
  sessions: (ip: string, token: string) =>
    ['session-picker', ip, token, 'sessions'] as const,
  projects: (ip: string, token: string) =>
    ['session-picker', ip, token, 'projects'] as const,
}

export function useSessionPickerWs(ip: string, token: string, profileId: string | null = null) {
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const selectedRef = useRef(false)
  const isMountedRef = useRef(true)
  const pendingDeletions = useRef<Map<string, () => void>>(new Map())
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true
      selectedRef.current = false
      setConnectionStatus('connecting')
      queryClient.setQueryData(sessionPickerKeys.sessions(ip, token), undefined)
      queryClient.setQueryData(sessionPickerKeys.projects(ip, token), undefined)

      const ws = new WebSocket(`ws://${ip}:${DEFAULT_WS_PORT}`)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token } satisfies WsMessage))
      }

      ws.onmessage = (e) => {
        let msg: WsMessage
        try {
          msg = JSON.parse(e.data)
        } catch (err) {
          console.error('[useSessionPickerWs] WebSocket メッセージのパースに失敗しました:', err)
          return
        }

        if (msg.type === 'auth_ok') {
          setConnectionStatus('connected')
          // サーバー名が取得できた場合、プロファイル名がIPのまま（未命名）なら自動更新する
          if (profileId && msg.serverName) {
            AsyncStorage.getItem(PROFILES_KEY).then((stored) => {
              if (!stored) return
              try {
                const profiles: ConnectionProfile[] = JSON.parse(stored)
                const profile = profiles.find((p) => p.id === profileId)
                if (profile && profile.name === ip) {
                  const updated = profiles.map((p) =>
                    p.id === profileId ? { ...p, name: msg.serverName } : p,
                  )
                  AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(updated))
                }
              } catch {
                // パース失敗は無視
              }
            })
          }
        } else if (msg.type === 'session_list') {
          queryClient.setQueryData(sessionPickerKeys.sessions(ip, token), {
            sessions: msg.sessions,
            multiplexerSessions: msg.multiplexerSessions ?? [],
          } satisfies SessionsData)
        } else if (msg.type === 'project_list') {
          queryClient.setQueryData(sessionPickerKeys.projects(ip, token), msg.projects)
        } else if (msg.type === 'session_deleted') {
          pendingDeletions.current.get(msg.sessionId)?.()
          pendingDeletions.current.delete(msg.sessionId)
          queryClient.setQueryData(
            sessionPickerKeys.sessions(ip, token),
            (old: SessionsData | undefined) => {
              if (!old) return old
              return { ...old, sessions: old.sessions.filter((s) => s.id !== msg.sessionId) }
            },
          )
        } else if (msg.type === 'auth_error') {
          setConnectionStatus('error')
          ws.close()
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' } satisfies WsMessage))
        }
      }

      ws.onerror = () => setConnectionStatus('error')
      ws.onclose = () => {
        if (isMountedRef.current && !selectedRef.current) {
          setConnectionStatus((s) => (s === 'connected' ? 'error' : s))
        }
      }

      return () => {
        isMountedRef.current = false
        ws.close()
      }
    }, [ip, token, profileId, queryClient]),
  )

  // Data comes exclusively from WebSocket via setQueryData.
  // enabled: false prevents React Query from ever fetching via HTTP.
  const { data: sessionData } = useQuery<SessionsData | undefined>({
    queryKey: sessionPickerKeys.sessions(ip, token),
    queryFn: () => Promise.resolve(undefined),
    enabled: false,
    staleTime: Infinity,
    gcTime: 0,
  })

  const { data: projects = [] } = useQuery<ProjectInfo[]>({
    queryKey: sessionPickerKeys.projects(ip, token),
    queryFn: () => Promise.resolve([]),
    enabled: false,
    staleTime: Infinity,
    gcTime: 0,
  })

  // mutationFn resolves when the server confirms deletion via session_deleted.
  // isPending stays true until confirmation arrives, allowing per-row loading state.
  const { mutate: deleteSession, isPending: isDeletingSession, variables: deletingSessionId } =
    useMutation({
      mutationFn: (sessionId: string) =>
        new Promise<void>((resolve) => {
          pendingDeletions.current.set(sessionId, resolve)
          wsRef.current?.send(
            JSON.stringify({ type: 'session_delete', sessionId } satisfies WsMessage),
          )
        }),
      onError: (_, sessionId) => {
        pendingDeletions.current.delete(sessionId)
      },
    })

  return {
    connectionStatus,
    sessions: sessionData?.sessions ?? [],
    multiplexerSessions: sessionData?.multiplexerSessions ?? [],
    projects,
    deleteSession,
    isDeletingSession,
    deletingSessionId,
    wsRef,
    selectedRef,
  }
}
