import React, { useState } from 'react'
import {
  View,
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
} from 'react-native'
import WebView from 'react-native-webview'

interface Props {
  webViewRef: React.RefObject<WebView | null>
}

type Key =
  | { kind: 'literal'; label: string; data: string }
  | { kind: 'ctrl-toggle'; label: string }

const BASE_KEYS: Key[] = [
  { kind: 'literal', label: 'ESC', data: '\x1b' },
  { kind: 'literal', label: 'Tab', data: '\t' },
  { kind: 'literal', label: '↑', data: '\x1b[A' },
  { kind: 'literal', label: '↓', data: '\x1b[B' },
  { kind: 'literal', label: '←', data: '\x1b[D' },
  { kind: 'literal', label: '→', data: '\x1b[C' },
  { kind: 'literal', label: '|', data: '|' },
  { kind: 'literal', label: '~', data: '~' },
  { kind: 'literal', label: '`', data: '`' },
  { kind: 'literal', label: '-', data: '-' },
  { kind: 'literal', label: '_', data: '_' },
  { kind: 'literal', label: '/', data: '/' },
  { kind: 'literal', label: '\\', data: '\\' },
]

// Ctrl+X のキー一覧（大文字英字）
const CTRL_KEYS = ['C', 'D', 'Z', 'L', 'A', 'E', 'W', 'U', 'K', 'R']

export function KeyboardToolbar({ webViewRef }: Props) {
  const [ctrlActive, setCtrlActive] = useState(false)

  function sendInput(data: string) {
    if (!webViewRef.current) return
    webViewRef.current.injectJavaScript(
      `window.sendInput(${JSON.stringify(data)}); true;`,
    )
  }

  function handleCtrlKey(ch: string) {
    // Ctrl+C = \x03, Ctrl+D = \x04, ... (大文字コード - 64)
    const data = String.fromCharCode(ch.charCodeAt(0) - 64)
    sendInput(data)
    setCtrlActive(false)
  }

  return (
    <View style={styles.toolbar}>
      {/* CTRL トグルボタン（常に左固定） */}
      <TouchableOpacity
        style={[styles.ctrlToggle, ctrlActive && styles.ctrlToggleActive]}
        onPress={() => setCtrlActive((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={[styles.keyText, ctrlActive && styles.ctrlActiveText]}>CTRL</Text>
      </TouchableOpacity>

      {/* スクロール可能なキー行 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.scrollContent}
      >
        {ctrlActive
          ? CTRL_KEYS.map((ch) => (
              <TouchableOpacity
                key={`ctrl-${ch}`}
                style={[styles.key, styles.ctrlKey]}
                onPress={() => handleCtrlKey(ch)}
                activeOpacity={0.6}
              >
                <Text style={[styles.keyText, styles.ctrlKeyText]}>^{ch}</Text>
              </TouchableOpacity>
            ))
          : BASE_KEYS.map((key) => (
              <TouchableOpacity
                key={key.label}
                style={styles.key}
                onPress={() => {
                  if (key.kind === 'literal') sendInput(key.data)
                }}
                activeOpacity={0.6}
              >
                <Text style={styles.keyText}>{key.label}</Text>
              </TouchableOpacity>
            ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    height: 44,
  },
  ctrlToggle: {
    paddingHorizontal: 12,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(255,255,255,0.12)',
  },
  ctrlToggleActive: {
    backgroundColor: 'rgba(86,156,214,0.25)',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  key: {
    paddingHorizontal: 10,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
    marginHorizontal: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  ctrlKey: {
    backgroundColor: 'rgba(86,156,214,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(86,156,214,0.4)',
  },
  keyText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontFamily: 'Menlo',
  },
  ctrlActiveText: {
    color: '#569cd6',
  },
  ctrlKeyText: {
    color: '#569cd6',
  },
})
