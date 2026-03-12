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
import { DEFAULT_WS_PORT, ProjectInfo, WsMessage } from '@remocoder/shared'

interface Props {
  ip: string
  token: string
  /** プロジェクト選択時に呼ばれる。null は新規セッション（プロジェクトなし） */
  onSelectProject: (projectPath: string | null) => void
  onBack: () => void
}

type Status = 'connecting' | 'connected' | 'error'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SessionPickerScreen({ ip, token, onSelectProject, onBack }: Props) {
  const [status, setStatus] = useState<Status>('connecting')
  const [projects, setProjects] = useState<ProjectInfo[]>([])
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
        } else if (msg.type === 'project_list') {
          setProjects(msg.projects)
        } else if (msg.type === 'auth_error') {
          setStatus('error')
          ws.close()
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
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

  const handleSelect = (projectPath: string | null) => {
    selectedRef.current = true
    wsRef.current?.close()
    onSelectProject(projectPath)
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.title}>プロジェクトを選択</Text>
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
          data={projects}
          keyExtractor={(item) => item.path}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <TouchableOpacity style={styles.newSessionButton} onPress={() => handleSelect(null)}>
              <Text style={styles.newSessionIcon}>＋</Text>
              <Text style={styles.newSessionText}>新規セッション（プロジェクトなし）</Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>最近使ったプロジェクトはありません</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.projectRow} onPress={() => handleSelect(item.path)}>
              <View style={styles.projectLeft}>
                <Text style={styles.projectName}>{item.name}</Text>
                <Text style={styles.projectPath} numberOfLines={1} ellipsizeMode="middle">
                  {item.path}
                </Text>
              </View>
              <Text style={styles.projectDate}>{formatDate(item.lastUsedAt)}</Text>
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
    marginBottom: 8,
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
