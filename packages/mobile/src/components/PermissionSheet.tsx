import React, { useEffect, useMemo, useRef } from 'react'
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export interface PermissionRequest {
  requestId: string
  toolName: string
  details: string[]
  requiresAlways: boolean
  createdAt: number
}

interface Props {
  request: PermissionRequest | null
  onDecide: (requestId: string, decision: 'approve' | 'reject' | 'always') => void
}

const TIMEOUT_MS = 60000
const DANGER_COLOR = '#f44747'

/** Tool name → action description and detail label mapping */
const TOOL_INFO: Record<string, { action: string; detailLabel: string }> = {
  Bash:      { action: 'Run shell command',    detailLabel: 'Command' },
  Read:      { action: 'Read file',            detailLabel: 'Target file' },
  Write:     { action: 'Write file',           detailLabel: 'Target file' },
  Edit:      { action: 'Edit file',            detailLabel: 'Target file' },
  MultiEdit: { action: 'Edit files in bulk',   detailLabel: 'Target file' },
  Glob:      { action: 'Search files',         detailLabel: 'Search pattern' },
  Grep:      { action: 'Search file contents', detailLabel: 'Search pattern' },
  LS:        { action: 'List directory',       detailLabel: 'Target path' },
  WebFetch:  { action: 'Fetch URL',            detailLabel: 'URL' },
  WebSearch: { action: 'Web search',           detailLabel: 'Search query' },
}

const DANGER_PATTERNS = [
  /\brm\s+(-\w*[rf]\w*\s+|--recursive|--force)/,
  /\bsudo\b/,
  /\bdd\s+/,
  /\bmkfs\b/,
  />\s*\/dev\//,
  /\bchmod\s+[0-7]{2}[2367]\b/,
]

function isDangerous(details: string[]): boolean {
  return details.some(line => DANGER_PATTERNS.some(re => re.test(line)))
}

export function PermissionSheet({ request, onDecide }: Props) {
  const { bottom: bottomInset } = useSafeAreaInsets()
  const slideAnim = useRef(new Animated.Value(300)).current
  const progressAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!request) return
    // 経過時間を考慮した残り時間・進捗を計算（再接続時にタイマーが正確に引き継がれる）
    const elapsed = Date.now() - request.createdAt
    const remaining = Math.max(TIMEOUT_MS - elapsed, 0)
    const initialProgress = Math.min(remaining / TIMEOUT_MS, 1)
    slideAnim.setValue(300)
    const spring = Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 4 })
    const timing = Animated.timing(progressAnim, { toValue: 0, duration: remaining, useNativeDriver: false })
    spring.start()
    progressAnim.setValue(initialProgress)
    timing.start(({ finished }) => { if (finished) onDecide(request.requestId, 'reject') })
    return () => { spring.stop(); timing.stop() }
  }, [request, slideAnim, progressAnim, onDecide])

  const toolInfo = request ? TOOL_INFO[request.toolName] : undefined
  const dangerous = useMemo(() => request ? isDangerous(request.details) : false, [request])

  if (!request) return null
  const decide = (decision: 'approve' | 'reject' | 'always') => onDecide(request.requestId, decision)

  const sheetPaddingBottom = 24 + bottomInset

  return (
    <Animated.View
      style={[
        styles.sheet,
        { paddingBottom: sheetPaddingBottom, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {/* Progress bar */}
      <Animated.View
        style={[
          styles.progressBar,
          {
            backgroundColor: dangerous ? DANGER_COLOR : '#4ec9b0',
            width: progressAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />

      {/* Tool name + action description */}
      <Text style={styles.toolLabel}>Permission Request</Text>
      <View style={styles.toolRow}>
        <Text style={styles.toolName}>{request.toolName}</Text>
        {toolInfo && <Text style={styles.toolAction}>{toolInfo.action}</Text>}
        {dangerous && <Text style={styles.dangerBadge}>⚠ Danger</Text>}
      </View>

      {/* Details */}
      {request.details.length > 0 && (
        <View style={[styles.detailsBox, dangerous && styles.detailsBoxDanger]}>
          {toolInfo && <Text style={styles.detailLabel}>{toolInfo.detailLabel}</Text>}
          <ScrollView style={styles.detailsScroll} nestedScrollEnabled>
            {request.details.map((line, i) => (
              <Text
                key={i}
                style={[styles.detailLine, dangerous && styles.detailLineDanger]}
              >
                {line}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Buttons */}
      <View style={styles.buttons}>
        <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={() => decide('reject')}>
          <Text style={styles.btnText}>Deny</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnApprove]} onPress={() => decide('approve')}>
          <Text style={styles.btnText}>Allow</Text>
        </TouchableOpacity>
        {request.requiresAlways && (
          <TouchableOpacity style={[styles.btn, styles.btnAlways]} onPress={() => decide('always')}>
            <Text style={styles.btnText}>Always Allow</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#0d1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 4,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  toolLabel: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  toolName: {
    color: '#c9d1d9',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  toolAction: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '400',
  },
  dangerBadge: {
    color: DANGER_COLOR,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(244,71,71,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  detailsBox: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  detailsBoxDanger: {
    borderWidth: 1,
    borderColor: 'rgba(244,71,71,0.35)', // DANGER_COLOR at 35% opacity
  },
  detailLabel: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  detailsScroll: {
    maxHeight: 100,
  },
  detailLine: {
    color: '#d4d4d4',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  detailLineDanger: {
    color: '#f97583',
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnReject: {
    backgroundColor: 'rgba(244,71,71,0.2)', // DANGER_COLOR at 20% opacity
    borderWidth: 1,
    borderColor: 'rgba(244,71,71,0.4)',
  },
  btnApprove: {
    backgroundColor: 'rgba(78,201,176,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(78,201,176,0.4)',
  },
  btnAlways: {
    backgroundColor: 'rgba(86,156,214,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(86,156,214,0.4)',
  },
  btnText: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: '600',
  },
})
