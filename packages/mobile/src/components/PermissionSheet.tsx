import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export interface PermissionRequest {
  requestId: string
  toolName: string
  details: string[]
  requiresAlways: boolean
}

interface Props {
  request: PermissionRequest | null
  onDecide: (requestId: string, decision: 'approve' | 'reject' | 'always') => void
}

const TIMEOUT_MS = 60000

export function PermissionSheet({ request, onDecide }: Props) {
  const { bottom: bottomInset } = useSafeAreaInsets()
  const slideAnim = useRef(new Animated.Value(300)).current
  const progressAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!request) return
    slideAnim.setValue(300)
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
    progressAnim.setValue(1)
    Animated.timing(progressAnim, { toValue: 0, duration: TIMEOUT_MS, useNativeDriver: false }).start()
  }, [request, slideAnim, progressAnim])

  if (!request) return null

  return (
    <Animated.View
      style={[styles.sheet, { paddingBottom: 24 + bottomInset, transform: [{ translateY: slideAnim }] }]}
    >
      {/* Progress bar */}
      <Animated.View
        style={[
          styles.progressBar,
          {
            width: progressAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />

      {/* Tool name */}
      <Text style={styles.toolLabel}>承認リクエスト</Text>
      <Text style={styles.toolName}>{request.toolName}</Text>

      {/* Details */}
      {request.details.length > 0 && (
        <View style={styles.detailsBox}>
          {request.details.map((line, i) => (
            <Text key={i} style={styles.detailLine} numberOfLines={3} ellipsizeMode="middle">
              {line}
            </Text>
          ))}
        </View>
      )}

      {/* Buttons */}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, styles.btnReject]}
          onPress={() => onDecide(request.requestId, 'reject')}
        >
          <Text style={styles.btnText}>拒否</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnApprove]}
          onPress={() => onDecide(request.requestId, 'approve')}
        >
          <Text style={styles.btnText}>許可</Text>
        </TouchableOpacity>
        {request.requiresAlways && (
          <TouchableOpacity
            style={[styles.btn, styles.btnAlways]}
            onPress={() => onDecide(request.requestId, 'always')}
          >
            <Text style={styles.btnText}>常に許可</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
    backgroundColor: '#4ec9b0',
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
  toolName: {
    color: '#c9d1d9',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 10,
  },
  detailsBox: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
    gap: 4,
  },
  detailLine: {
    color: '#d4d4d4',
    fontSize: 12,
    fontFamily: 'monospace',
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
    backgroundColor: 'rgba(244,71,71,0.2)',
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
