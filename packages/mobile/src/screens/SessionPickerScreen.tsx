import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { DEFAULT_WS_PORT, MultiplexerSessionInfo, ProjectInfo, SessionInfo, SessionSource, WsMessage } from '@remocoder/shared'
import { firstParam, formatDate, getSessionDisplayName, PROFILES_KEY, ConnectionProfile } from '../utils'

type Status = 'connecting' | 'connected' | 'error'

type ListItem =
  | { kind: 'header'; label: string }
  | { kind: 'newSession' }
  | { kind: 'session'; session: SessionInfo }
  | { kind: 'multiplexer'; mux: MultiplexerSessionInfo }
  | { kind: 'project'; project: ProjectInfo }

export function SessionPickerScreen() {
  const raw = useLocalSearchParams<{ ip: string; token: string; profileId?: string }>()
  const router = useRouter()
  const ip = firstParam(raw.ip)
  const token = firstParam(raw.token)
  const profileId = firstParam(raw.profileId)
  const [status, setStatus] = useState<Status>('connecting')
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [multiplexerSessions, setMultiplexerSessions] = useState<MultiplexerSessionInfo[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const selectedRef = useRef(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    const ws = new WebSocket(`ws://${ip}:${DEFAULT_WS_PORT}`)
    wsRef.current = ws

    ws.onopen = () => {
      const msg: WsMessage = { type: 'auth', token }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (e) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(e.data)
      } catch (err) {
        console.error('[SessionPickerScreen] WebSocket メッセージのパースに失敗しました:', err)
        return
      }
      if (msg.type === 'auth_ok') {
        setStatus('connected')
        if (profileId && msg.serverName) {
          AsyncStorage.getItem(PROFILES_KEY).then((stored) => {
            if (!stored) return
            try {
              const profiles: ConnectionProfile[] = JSON.parse(stored)
              const profile = profiles.find((p) => p.id === profileId)
              // 名前がIPのまま（未命名）の場合のみ上書きする
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
      } else if (msg.type === 'project_list') {
        setProjects(msg.projects)
      } else if (msg.type === 'session_list') {
        setSessions(msg.sessions)
        setMultiplexerSessions(msg.multiplexerSessions ?? [])
      } else if (msg.type === 'session_deleted') {
        setSessions((prev) => prev.filter((s) => s.id !== msg.sessionId))
        setDeletingId(null)
      } else if (msg.type === 'auth_error') {
        setStatus('error')
        ws.close()
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
    }

    ws.onerror = () => setStatus('error')
    ws.onclose = () => {
      if (isMountedRef.current && !selectedRef.current) {
        setStatus((s) => (s === 'connected' ? 'error' : s))
      }
    }

    return () => {
      isMountedRef.current = false
      ws.close()
    }
  }, [ip, token])

  const navigateToTerminal = useCallback(
    (params: Record<string, string>) => {
      selectedRef.current = true
      wsRef.current?.close()
      router.push({ pathname: '/terminal', params: { ip, token, ...params } })
    },
    [router, ip, token],
  )

  const handleSelectProject = (projectPath: string | null) =>
    navigateToTerminal({ projectPath: projectPath ?? '' })

  const handleAttachSession = (sessionId: string) =>
    navigateToTerminal({ sessionId })

  const handleDeleteSession = useCallback(
    (session: SessionInfo) => {
      const name = getSessionDisplayName(session)
      Alert.alert(
        'セッションを削除',
        `「${name}」を終了して削除しますか？`,
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '削除',
            style: 'destructive',
            onPress: () => {
              setDeletingId(session.id)
              const msg: WsMessage = { type: 'session_delete', sessionId: session.id }
              wsRef.current?.send(JSON.stringify(msg))
            },
          },
        ],
      )
    },
    [],
  )

  const handleAttachMultiplexer = (mux: MultiplexerSessionInfo) => {
    const source: SessionSource = { kind: mux.tool, sessionName: mux.sessionName }
    navigateToTerminal({ source: JSON.stringify(source) })
  }

  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = []
    if (sessions.length > 0) {
      items.push({ kind: 'header', label: '実行中のセッション' })
      sessions.forEach((s) => items.push({ kind: 'session', session: s }))
    }
    if (multiplexerSessions.length > 0) {
      items.push({ kind: 'header', label: 'マルチプレクサ' })
      multiplexerSessions.forEach((m) => items.push({ kind: 'multiplexer', mux: m }))
    }
    items.push({ kind: 'header', label: '新規セッション' })
    items.push({ kind: 'newSession' })
    projects.forEach((p) => items.push({ kind: 'project', project: p }))
    return items
  }, [sessions, multiplexerSessions, projects])

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.title}>セッションを選択</Text>
        <View style={styles.headerRight} />
      </View>

      {status === 'connecting' && (
        <View style={styles.center}>
          <ActivityIndicator color="#4ec9b0" size="large" />
          <Text style={styles.statusText}>接続中...</Text>
        </View>
      )}

      {status === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errorText}>接続エラーが発生しました</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>戻る</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'connected' && (
        <FlatList
          data={listData}
          keyExtractor={(item, i) => {
            if (item.kind === 'header') return `header-${item.label}`
            if (item.kind === 'newSession') return 'newSession'
            if (item.kind === 'session') return `session-${item.session.id}`
            if (item.kind === 'multiplexer') return `mux-${item.mux.tool}-${item.mux.sessionName}`
            if (item.kind === 'project') return `project-${item.project.path}`
            return String(i)
          }}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return <Text style={styles.sectionTitle}>{item.label}</Text>
            }
            if (item.kind === 'newSession') {
              return (
                <TouchableOpacity
                  style={styles.newSessionButton}
                  onPress={() => handleSelectProject(null)}
                >
                  <Text style={styles.newSessionIcon}>＋</Text>
                  <Text style={styles.newSessionText}>プロジェクトなし</Text>
                </TouchableOpacity>
              )
            }
            if (item.kind === 'session') {
              const { session } = item
              const name = getSessionDisplayName(session)
              const isDeleting = deletingId === session.id
              return (
                <TouchableOpacity
                  style={[styles.sessionRow, isDeleting && styles.sessionRowDeleting]}
                  onPress={() => !isDeleting && handleAttachSession(session.id)}
                  onLongPress={() => !isDeleting && handleDeleteSession(session)}
                  delayLongPress={500}
                >
                  <View
                    style={[
                      styles.statusDot,
                      session.status === 'active' ? styles.dotActive : styles.dotIdle,
                    ]}
                  />
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionName}>{name}</Text>
                    {session.projectPath && (
                      <Text style={styles.sessionPath} numberOfLines={1} ellipsizeMode="middle">
                        {session.projectPath}
                      </Text>
                    )}
                    <Text style={styles.sessionMeta}>
                      {session.status === 'active' ? 'アクティブ' : 'アイドル'}
                      {session.hasClient ? ' · 接続中' : ''}
                    </Text>
                  </View>
                  {isDeleting
                    ? <ActivityIndicator size="small" color="#f85149" />
                    : <Text style={styles.attachArrow}>→</Text>
                  }
                </TouchableOpacity>
              )
            }
            if (item.kind === 'multiplexer') {
              const { mux } = item
              return (
                <TouchableOpacity
                  style={styles.sessionRow}
                  onPress={() => handleAttachMultiplexer(mux)}
                >
                  <View style={[styles.statusDot, styles.dotIdle]} />
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionName}>{mux.sessionName}</Text>
                    <Text style={styles.sessionMeta}>
                      {mux.tool.toUpperCase()}{mux.detail ? ` · ${mux.detail}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.attachArrow}>→</Text>
                </TouchableOpacity>
              )
            }
            if (item.kind === 'project') {
              const { project } = item
              return (
                <TouchableOpacity
                  style={styles.projectRow}
                  onPress={() => handleSelectProject(project.path)}
                >
                  <View style={styles.projectLeft}>
                    <Text style={styles.projectName}>{project.name}</Text>
                    <Text style={styles.projectPath} numberOfLines={1} ellipsizeMode="middle">
                      {project.path}
                    </Text>
                  </View>
                  <Text style={styles.projectDate}>{formatDate(project.lastUsedAt)}</Text>
                </TouchableOpacity>
              )
            }
            return null
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  backButtonText: {
    color: '#4ec9b0',
    fontSize: 14,
  },
  title: {
    color: '#c9d1d9',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  headerRight: {
    width: 60,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusText: {
    color: '#8b949e',
    fontSize: 14,
  },
  errorText: {
    color: '#f85149',
    fontSize: 14,
    marginBottom: 16,
  },
  backBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 6,
  },
  backBtnText: {
    color: '#c9d1d9',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    gap: 6,
  },
  sectionTitle: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 6,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  sessionRowDeleting: {
    opacity: 0.5,
    borderColor: 'rgba(248,81,73,0.3)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
    marginTop: 2,
  },
  dotActive: {
    backgroundColor: '#4ec9b0',
  },
  dotIdle: {
    backgroundColor: '#dcdcaa',
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },
  sessionName: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: '600',
  },
  sessionPath: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  sessionMeta: {
    color: '#8b949e',
    fontSize: 11,
  },
  attachArrow: {
    color: '#8b949e',
    fontSize: 16,
  },
  newSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(78,201,176,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(78,201,176,0.3)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  newSessionIcon: {
    color: '#4ec9b0',
    fontSize: 18,
    lineHeight: 20,
  },
  newSessionText: {
    color: '#4ec9b0',
    fontSize: 15,
    fontWeight: '600',
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  projectLeft: {
    flex: 1,
    gap: 3,
  },
  projectName: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: '600',
  },
  projectPath: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  projectDate: {
    color: '#8b949e',
    fontSize: 11,
    flexShrink: 0,
  },
})
