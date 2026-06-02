import React, { useCallback, useEffect, useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { MultiplexerSessionInfo, ProjectInfo, SessionInfo, SessionSource } from '@remocoder/shared'
import { firstParam, formatDate, getSessionDisplayName } from '../utils'
import { useSessionPickerWs } from '../hooks/useSessionPickerWs'

// ── モバイル用ヘルパー ──────────────────────────────────────────────────────

function mobileSourceIcon(source?: SessionSource): string {
  if (!source) return '🖥'
  switch (source.kind) {
    case 'claude': return '🤖'
    case 'shell':  return '🐚'
    case 'tmux':   return '📟'
    case 'screen': return '🖥'
    case 'zellij': return '🪟'
    default:       return '🖥'
  }
}

function mobileProjectName(session: SessionInfo): string | undefined {
  const path =
    (session.source?.kind === 'claude' ? session.source.projectPath : undefined) ??
    session.projectPath
  if (!path) return undefined
  return path.split('/').filter(Boolean).pop()
}

function mobileFormatElapsed(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h} hr ago`
}

function mobilePhaseBadgeText(phase?: SessionInfo['claudePhase']): string | null {
  switch (phase) {
    case 'thinking': return '✦ THINKING'
    case 'writing':  return '✦ WRITING'
    case 'waiting':  return '? WAITING'
    default:         return null
  }
}

const LABEL_KEY_PREFIX = 'session-label-'

function useMobileLabels(sessionIds: string[]) {
  const [labels, setLabels] = React.useState<Record<string, string>>({})

  useEffect(() => {
    if (sessionIds.length === 0) return
    const keys = sessionIds.map((id) => LABEL_KEY_PREFIX + id)
    AsyncStorage.multiGet(keys).then((pairs) => {
      const map: Record<string, string> = {}
      pairs.forEach(([key, value]) => {
        if (value) map[key.replace(LABEL_KEY_PREFIX, '')] = value
      })
      setLabels(map)
    })
  }, [sessionIds.join(',')])

  const setLabel = async (sessionId: string, label: string) => {
    if (label.trim()) {
      await AsyncStorage.setItem(LABEL_KEY_PREFIX + sessionId, label.trim())
      setLabels((prev) => ({ ...prev, [sessionId]: label.trim() }))
    } else {
      await AsyncStorage.removeItem(LABEL_KEY_PREFIX + sessionId)
      setLabels((prev) => { const next = { ...prev }; delete next[sessionId]; return next })
    }
  }

  return { labels, setLabel }
}

function RenameModal({
  visible,
  initialValue,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  initialValue: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = React.useState(initialValue)

  useEffect(() => {
    if (visible) setValue(initialValue)
  }, [visible, initialValue])

  if (!visible) return null

  return (
    <View style={renameStyles.overlay}>
      <View style={renameStyles.modal}>
        <Text style={renameStyles.title}>Rename Session</Text>
        <TextInput
          style={renameStyles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Session name"
          placeholderTextColor="#8b949e"
          autoFocus
          selectTextOnFocus
        />
        <View style={renameStyles.buttons}>
          <TouchableOpacity style={renameStyles.cancelBtn} onPress={onCancel}>
            <Text style={renameStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={renameStyles.confirmBtn} onPress={() => onConfirm(value)}>
            <Text style={renameStyles.confirmText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const renameStyles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    backgroundColor: '#161b22', borderRadius: 12, padding: 20,
    width: '80%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    gap: 14,
  },
  title: { color: '#c9d1d9', fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: '#0d1117', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: '#c9d1d9', fontSize: 14,
  },
  buttons: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' },
  cancelText: { color: '#8b949e', fontSize: 14 },
  confirmBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: 'rgba(78,201,176,0.15)', borderWidth: 1, borderColor: 'rgba(78,201,176,0.3)' },
  confirmText: { color: '#4ec9b0', fontSize: 14, fontWeight: '600' },
})

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

  const {
    connectionStatus,
    sessions,
    multiplexerSessions,
    projects,
    deleteSession,
    isDeletingSession,
    deletingSessionId,
    wsRef,
    selectedRef,
  } = useSessionPickerWs(ip, token, profileId ?? null)

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions])
  const { labels, setLabel } = useMobileLabels(sessionIds)

  const [renameTarget, setRenameTarget] = React.useState<{ id: string; current: string } | null>(null)

  const navigateToTerminal = useCallback(
    (params: Record<string, string>) => {
      selectedRef.current = true
      wsRef.current?.close()
      router.push({ pathname: '/terminal', params: { ip, token, ...params } })
    },
    [router, ip, token, wsRef, selectedRef],
  )

  const handleSelectProject = useCallback(
    (projectPath: string | null) => navigateToTerminal({ projectPath: projectPath ?? '' }),
    [navigateToTerminal],
  )

  const handleAttachSession = useCallback(
    (sessionId: string) => navigateToTerminal({ sessionId }),
    [navigateToTerminal],
  )

  const handleLongPressSession = useCallback(
    (session: SessionInfo) => {
      if (isDeletingSession) return
      const name = labels[session.id] || getSessionDisplayName(session)
      Alert.alert(
        name,
        'Choose an action',
        [
          {
            text: 'Rename',
            onPress: () => setRenameTarget({ id: session.id, current: labels[session.id] ?? '' }),
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Delete Session',
                `Terminate and delete "${name}"?`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => deleteSession(session.id) },
                ],
              )
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      )
    },
    [isDeletingSession, labels, deleteSession],
  )

  const handleAttachMultiplexer = (mux: MultiplexerSessionInfo) => {
    const source: SessionSource = { kind: mux.tool, sessionName: mux.sessionName }
    navigateToTerminal({ source: JSON.stringify(source) })
  }

  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = []
    if (sessions.length > 0) {
      items.push({ kind: 'header', label: 'Active Sessions' })
      sessions.forEach((s) => items.push({ kind: 'session', session: s }))
    }
    if (multiplexerSessions.length > 0) {
      items.push({ kind: 'header', label: 'Multiplexers' })
      multiplexerSessions.forEach((m) => items.push({ kind: 'multiplexer', mux: m }))
    }
    items.push({ kind: 'header', label: 'New Session' })
    items.push({ kind: 'newSession' })
    projects.forEach((p) => items.push({ kind: 'project', project: p }))
    return items
  }, [sessions, multiplexerSessions, projects])

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Select Session</Text>
        <View style={styles.headerRight} />
      </View>

      {connectionStatus === 'connecting' && (
        <View style={styles.center}>
          <ActivityIndicator color="#4ec9b0" size="large" />
          <Text style={styles.statusText}>Connecting...</Text>
        </View>
      )}

      {connectionStatus === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errorText}>Connection error</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {connectionStatus === 'connected' && (
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
                  <Text style={styles.newSessionText}>No project</Text>
                </TouchableOpacity>
              )
            }
            if (item.kind === 'session') {
              const { session } = item
              const label = labels[session.id]
              const projectName = mobileProjectName(session)
              const displayName = label || projectName || getSessionDisplayName(session)
              const icon = mobileSourceIcon(session.source)
              const phaseBadge = mobilePhaseBadgeText(session.claudePhase)
              const isDeleting = isDeletingSession && deletingSessionId === session.id
              return (
                <TouchableOpacity
                  style={[styles.sessionRow, isDeleting && styles.sessionRowDeleting]}
                  onPress={() => !isDeleting && handleAttachSession(session.id)}
                  onLongPress={() => !isDeleting && handleLongPressSession(session)}
                  delayLongPress={500}
                >
                  <View
                    style={[
                      styles.statusDot,
                      session.status === 'active' ? styles.dotActive : styles.dotIdle,
                    ]}
                  />
                  <View style={styles.sessionInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={styles.sessionName}>{icon} {displayName}</Text>
                      {phaseBadge && (
                        <Text style={mobileSessionStyles.phaseBadge}>{phaseBadge}</Text>
                      )}
                    </View>
                    <Text style={styles.sessionMeta}>
                      {session.status === 'active' ? 'Active' : 'Idle'}
                      {session.hasClient ? ' · Connected' : ''}
                      {' · '}{mobileFormatElapsed(session.createdAt)}
                    </Text>
                    {session.lastOutputLine && (
                      <Text style={mobileSessionStyles.outputPreview} numberOfLines={1}>
                        ▸ {session.lastOutputLine}
                      </Text>
                    )}
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
                    {mux.workingDirectory ? (
                      <Text style={styles.sessionPath} numberOfLines={1} ellipsizeMode="middle">
                        {mux.workingDirectory}
                      </Text>
                    ) : null}
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
      <RenameModal
        visible={renameTarget !== null}
        initialValue={renameTarget?.current ?? ''}
        onConfirm={(value) => {
          if (renameTarget) setLabel(renameTarget.id, value)
          setRenameTarget(null)
        }}
        onCancel={() => setRenameTarget(null)}
      />
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

const mobileSessionStyles = StyleSheet.create({
  phaseBadge: {
    color: '#60a5fa',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  outputPreview: {
    color: '#4ec9b0',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
})
