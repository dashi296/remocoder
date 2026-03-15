import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

interface Props {
  permissionId: string
  toolName: string
  input: unknown
  prompt: string
  responded: boolean
  approved?: boolean
  onRespond: (permissionId: string, approved: boolean) => void
}

export function PermissionCard({
  permissionId,
  toolName,
  input,
  prompt,
  responded,
  approved,
  onRespond,
}: Props) {
  const [detailExpanded, setDetailExpanded] = useState(false)

  const inputStr =
    typeof input === 'string' ? input : JSON.stringify(input, null, 2)

  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <Text style={styles.headerIcon}>🔐</Text>
          <Text style={styles.headerTitle}>ツール実行の承認リクエスト</Text>
        </View>

        {/* ツール名 */}
        <View style={styles.body}>
          <Text style={styles.label}>ツール</Text>
          <Text style={styles.toolName}>{toolName}</Text>

          <Text style={styles.label}>内容</Text>
          <Text style={styles.prompt}>{prompt}</Text>

          {/* 詳細（入力パラメーター） */}
          <TouchableOpacity
            style={styles.detailToggle}
            onPress={() => setDetailExpanded((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.detailToggleText}>
              {detailExpanded ? '詳細を隠す ▲' : '詳細を見る ▼'}
            </Text>
          </TouchableOpacity>
          {detailExpanded && (
            <View style={styles.detailBox}>
              <Text style={styles.detailText}>{inputStr}</Text>
            </View>
          )}
        </View>

        {/* アクション */}
        <View style={styles.actions}>
          {responded ? (
            <View style={[styles.resultBadge, approved ? styles.badgeApproved : styles.badgeDenied]}>
              <Text style={styles.resultText}>{approved ? '✓ 承認済み' : '✕ 拒否済み'}</Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.btn, styles.btnDeny]}
                onPress={() => onRespond(permissionId, false)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnDenyText}>拒否</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnApprove]}
                onPress={() => onRespond(permissionId, true)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnApproveText}>承認</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(220,160,0,0.35)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(220,160,0,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(220,160,0,0.15)',
  },
  headerIcon: {
    fontSize: 16,
  },
  headerTitle: {
    color: '#dca000',
    fontSize: 13,
    fontWeight: '700',
  },
  body: {
    padding: 14,
    gap: 4,
  },
  label: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 2,
  },
  toolName: {
    color: '#dcdcaa',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, monospace',
    fontWeight: '600',
  },
  prompt: {
    color: '#c9d1d9',
    fontSize: 14,
    lineHeight: 20,
  },
  detailToggle: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  detailToggleText: {
    color: '#58a6ff',
    fontSize: 12,
    fontWeight: '600',
  },
  detailBox: {
    backgroundColor: '#0d1117',
    borderRadius: 6,
    padding: 10,
    marginTop: 6,
  },
  detailText: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: 'Menlo, Monaco, monospace',
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDeny: {
    backgroundColor: 'rgba(244,71,71,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244,71,71,0.35)',
  },
  btnApprove: {
    backgroundColor: 'rgba(78,201,176,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(78,201,176,0.4)',
  },
  btnDenyText: {
    color: '#f44747',
    fontWeight: '700',
    fontSize: 14,
  },
  btnApproveText: {
    color: '#4ec9b0',
    fontWeight: '700',
    fontSize: 14,
  },
  resultBadge: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  badgeApproved: {
    backgroundColor: 'rgba(78,201,176,0.1)',
  },
  badgeDenied: {
    backgroundColor: 'rgba(244,71,71,0.1)',
  },
  resultText: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '600',
  },
})
