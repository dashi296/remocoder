import React from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { SessionInfo, ProjectInfo } from '@remocoder/shared'
import { formatDate, getSessionDisplayName } from '../utils'

interface Props {
  visible: boolean
  loading: boolean
  sessions: SessionInfo[]
  projects: ProjectInfo[]
  currentSessionId: string | null
  onClose: () => void
  onSwitchSession: (sessionId: string) => void
  onCreateSession: (projectPath: string | null) => void
}

export function SessionSwitcherModal({
  visible,
  loading,
  sessions,
  projects,
  currentSessionId,
  onClose,
  onSwitchSession,
  onCreateSession,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Switch Session</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#4ec9b0" />
            </View>
          ) : (
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {sessions.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Active Sessions</Text>
                  {sessions.map((session) => {
                    const isCurrent = session.id === currentSessionId
                    const name = getSessionDisplayName(session)
                    return (
                      <TouchableOpacity
                        key={session.id}
                        style={[styles.sessionRow, isCurrent && styles.sessionRowCurrent]}
                        onPress={() => !isCurrent && onSwitchSession(session.id)}
                        disabled={isCurrent}
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
                        </View>
                        {isCurrent ? (
                          <Text style={styles.currentBadge}>Current</Text>
                        ) : (
                          <Text style={styles.switchArrow}>→</Text>
                        )}
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>New Session</Text>
                <TouchableOpacity
                  style={styles.newSessionButton}
                  onPress={() => onCreateSession(null)}
                >
                  <Text style={styles.newSessionIcon}>＋</Text>
                  <Text style={styles.newSessionText}>No project</Text>
                </TouchableOpacity>
                {projects.map((project) => (
                  <TouchableOpacity
                    key={project.path}
                    style={styles.projectRow}
                    onPress={() => onCreateSession(project.path)}
                  >
                    <View style={styles.projectLeft}>
                      <Text style={styles.projectName}>{project.name}</Text>
                      <Text style={styles.projectPath} numberOfLines={1} ellipsizeMode="middle">
                        {project.path}
                      </Text>
                    </View>
                    <Text style={styles.projectDate}>{formatDate(project.lastUsedAt)}</Text>
                  </TouchableOpacity>
                ))}
                {projects.length === 0 && (
                  <Text style={styles.emptyText}>No recent projects</Text>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#0d1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    color: '#c9d1d9',
    fontSize: 16,
    fontWeight: '600',
  },
  closeBtn: {
    padding: 4,
  },
  closeText: {
    color: '#8b949e',
    fontSize: 16,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  scroll: {
    paddingHorizontal: 16,
  },
  section: {
    paddingVertical: 12,
  },
  sectionTitle: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    gap: 10,
  },
  sessionRowCurrent: {
    borderColor: 'rgba(78,201,176,0.4)',
    backgroundColor: 'rgba(78,201,176,0.05)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
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
  currentBadge: {
    color: '#4ec9b0',
    fontSize: 11,
    fontWeight: '600',
  },
  switchArrow: {
    color: '#8b949e',
    fontSize: 14,
  },
  newSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(78,201,176,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(78,201,176,0.3)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  newSessionIcon: {
    color: '#4ec9b0',
    fontSize: 18,
    lineHeight: 20,
  },
  newSessionText: {
    color: '#4ec9b0',
    fontSize: 14,
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
    marginBottom: 6,
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
  emptyText: {
    color: '#8b949e',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
})
