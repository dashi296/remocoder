import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

interface Props {
  content: string
}

export function UserBubble({ content }: Props) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{content}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-end',
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  bubble: {
    backgroundColor: '#0e7afb',
    borderRadius: 16,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '80%',
  },
  text: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 22,
  },
})
