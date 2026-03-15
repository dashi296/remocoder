import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

interface Props {
  toolName: string
  input: unknown
}

export function ToolUseBubble({ toolName, input }: Props) {
  const [expanded, setExpanded] = useState(false)

  const inputStr =
    typeof input === 'string' ? input : JSON.stringify(input, null, 2)

  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.header}
          onPress={() => setExpanded((v) => !v)}
          activeOpacity={0.7}
        >
          <View style={styles.headerLeft}>
            <Text style={styles.icon}>🔧</Text>
            <Text style={styles.toolName}>{toolName}</Text>
          </View>
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {expanded && (
          <View style={styles.body}>
            <Text style={styles.inputText}>{inputStr}</Text>
          </View>
        )}
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
    borderColor: 'rgba(220,220,170,0.25)',
    overflow: 'hidden',
    maxWidth: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  icon: {
    fontSize: 14,
  },
  toolName: {
    color: '#dcdcaa',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Menlo, Monaco, monospace',
  },
  chevron: {
    color: '#8b949e',
    fontSize: 10,
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    padding: 10,
    backgroundColor: '#0d1117',
  },
  inputText: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: 'Menlo, Monaco, monospace',
    lineHeight: 16,
  },
})
