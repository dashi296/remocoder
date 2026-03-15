import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native'

interface Props {
  toolUseId: string
  content: string
  isError: boolean
}

const PREVIEW_LINES = 4

export function ToolResultBubble({ content, isError }: Props) {
  const lines = content.split('\n')
  const needsCollapse = lines.length > PREVIEW_LINES
  const [expanded, setExpanded] = useState(false)

  const displayedContent =
    needsCollapse && !expanded
      ? lines.slice(0, PREVIEW_LINES).join('\n') + '\n…'
      : content

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, isError && styles.cardError]}>
        <View style={styles.header}>
          <Text style={styles.icon}>{isError ? '❌' : '✅'}</Text>
          <Text style={[styles.label, isError && styles.labelError]}>
            {isError ? 'エラー' : '実行結果'}
          </Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.content}>{displayedContent}</Text>
          {needsCollapse && (
            <TouchableOpacity
              onPress={() => setExpanded((v) => !v)}
              style={styles.toggleBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.toggleText}>
                {expanded ? '折りたたむ ▲' : `全て表示 (${lines.length}行) ▼`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-start',
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(78,201,176,0.2)',
    overflow: 'hidden',
    maxWidth: '90%',
  },
  cardError: {
    borderColor: 'rgba(244,71,71,0.3)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  icon: {
    fontSize: 12,
  },
  label: {
    color: '#4ec9b0',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelError: {
    color: '#f44747',
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    padding: 10,
    backgroundColor: '#0d1117',
  },
  content: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  toggleBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  toggleText: {
    color: '#4ec9b0',
    fontSize: 11,
    fontWeight: '600',
  },
})
