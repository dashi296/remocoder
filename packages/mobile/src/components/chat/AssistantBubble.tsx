import React from 'react'
import { View, Text, StyleSheet, Platform } from 'react-native'

interface Props {
  content: string
}

/**
 * アシスタントのテキスト返答バブル。
 * コードブロック（``` で囲まれた部分）を等幅フォントで表示する。
 */
export function AssistantBubble({ content }: Props) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.bubble}>
        <TextWithCode text={content} />
      </View>
    </View>
  )
}

/** ``` コードブロックをインラインで等幅フォント表示する */
function TextWithCode({ text }: { text: string }) {
  // ``` で始まり ``` で終わるブロックを分割
  const parts = text.split(/(```[\s\S]*?```)/g)

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
          return (
            <View key={i} style={styles.codeBlock}>
              <Text style={styles.codeText}>{code}</Text>
            </View>
          )
        }
        return (
          <Text key={i} style={styles.text}>
            {part}
          </Text>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  bubble: {
    backgroundColor: '#161b22',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '85%',
  },
  text: {
    color: '#c9d1d9',
    fontSize: 15,
    lineHeight: 22,
  },
  codeBlock: {
    backgroundColor: '#0d1117',
    borderRadius: 6,
    padding: 10,
    marginVertical: 4,
  },
  codeText: {
    color: '#e6edf3',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
})
