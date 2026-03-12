import React, { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { DEFAULT_WS_PORT, SessionInfo, WsMessage } from '@remocoder/shared'

interface Props {
  ip: string
  token: string
  /** セッション選択時に呼ばれる。null は新規セッション作成 */
  onSelectSession: (sessionId: string | null) => void
  onBack: () => void
}

type Status = 'connecting' | 'connected' | 'error'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString()
}

export function SessionPickerScreen({ ip, token, onSelectSession, onBack }: Props) {
  const [status, setStatus] = useState<Status>('connecting')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const selectedRef = useRef(false)

  useEffect(() => {
    const ws = new WebSocket(`ws://${ip}:${DEFAULT_WS_PORT}`)
    wsRef.current = ws

    ws.onopen = () => {
      const msg: WsMessage = { type: 'auth', token }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data)
        if (msg.type === 'auth_ok') {
          setStatus('connected')
        } else if (msg.type === 'session_list') {
          setSessions(msg.sessions)
        } else if (msg.type === 'auth_error') {
          setStatus('error')
          ws.close()
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onerror = () => setStatus('error')
    ws.onclose = () => {
      if (!selectedRef.current) {
        setStatus((s) => (s === 'connected' ? 'error' : s))
      }
    }

    return () => {
      ws.close()
    }
  }, [ip, token])

  const handleSelect = (sessionId: string | null) => {
    selectedRef.current = true
    wsRef.current?.close()
    onSelectSession(sessionId)
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
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
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>戻る</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'connected' && (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <TouchableOpacity style={styles.newSessionButton} onPress={() => handleSelect(null)}>
              <Text style={styles.newSessionIcon}>＋</Text>
              <Text style={styles.newSessionText}>新規セッションを作成</Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>既存のセッションはありません</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.sessionRow} onPress={() => handleSelect(item.id)}>
              <View style={styles.sessionRowLeft}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: item.status === 'active' ? '#4ec9b0' : '#dcdcaa' },
                  ]}
                />
                <View style={styles.sessionMeta}>
                  <Text style={styles.sessionDate}>{formatDate(item.createdAt)}</Text>
                  {item.clientIP != null && (
                    <Text style={styles.sessionIP}>{item.clientIP}</Text>
                  )}
                </View>
              </View>
              <View style={styles.sessionRowRight}>
                <Text
                  style={[
                    styles.badge,
                    { color: item.status === 'active' ? '#4ec9b0' : '#dcdcaa' },
                  ]}
                >
                  {item.status === 'active' ? 'ACTIVE' : 'IDLE'}
                </Text>
                {item.hasClient && (
                  <Text style={styles.connectedBadge}>接続中</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
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
    gap: 8,
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
    marginBottom: 16,
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
  emptyText: {
    color: '#8b949e',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  sessionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  sessionMeta: {
    flex: 1,
  },
  sessionDate: {
    color: '#c9d1d9',
    fontSize: 13,
    fontWeight: '500',
  },
  sessionIP: {
    color: '#8b949e',
    fontSize: 11,
    marginTop: 2,
  },
  sessionRowRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  connectedBadge: {
    color: '#f85149',
    fontSize: 9,
    fontWeight: '600',
  },
})
