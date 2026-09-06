import React, { useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SlashCommandInfo } from '@remocoder/shared'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'

export const USAGE_STORAGE_KEY = 'slashCommandUsage'

interface Props {
  visible: boolean
  commands: SlashCommandInfo[]
  truncated?: boolean
  onClose: () => void
  onSelect: (name: string) => void
}

/** 保存済みの使用回数を読む。失敗時は空オブジェクトを返す */
export async function loadUsage(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as Record<string, number>
  } catch {
    return {}
  }
}

/**
 * recordUsage の書き込みを直列化するためのキュー。
 * read-modify-write を2つの await にまたがって行うため、直列化しないと
 * 連続で呼び出したとき（例: 連打）片方の read が古い値を読んで increment を
 * 消してしまう。
 */
let usageWriteQueue: Promise<void> = Promise.resolve()

/** 使用回数を1増やす。失敗しても例外にしない */
export function recordUsage(name: string): Promise<void> {
  const next = usageWriteQueue.catch(() => undefined).then(async () => {
    try {
      const usage = await loadUsage()
      usage[name] = (usage[name] ?? 0) + 1
      await AsyncStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage))
    } catch {
      // 使用回数は補助情報なので、保存に失敗しても操作は続行する
    }
  })
  usageWriteQueue = next
  return next
}

/** 使用回数の降順 → 名前の昇順で並べる。元の配列は変更しない */
export function sortCommands(
  commands: SlashCommandInfo[],
  usage: Record<string, number>,
): SlashCommandInfo[] {
  return [...commands].sort((a, b) => {
    const diff = (usage[b.name] ?? 0) - (usage[a.name] ?? 0)
    if (diff !== 0) return diff
    return a.name.localeCompare(b.name)
  })
}

export function SlashCommandSheet({ visible, commands, truncated, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<Record<string, number>>({})
  const keyboardHeight = useKeyboardHeight()

  useEffect(() => {
    if (!visible) return
    setQuery('')
    loadUsage().then(setUsage)
  }, [visible])

  const visibleCommands = useMemo(() => {
    const sorted = sortCommands(commands, usage)
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
    )
  }, [commands, usage, query])

  function handleSelect(name: string) {
    onSelect(name)
    recordUsage(name).then(() => loadUsage().then(setUsage))
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          testID="slash-command-sheet-container"
          // キーボード非表示時（keyboardHeight === 0）は 0 にフォールバックさせず
          // スタイルシート既定の 12 を使う。そうしないとホームインジケーターのある
          // 端末で最下行がインジケーターに接してしまう
          style={[styles.container, { paddingBottom: keyboardHeight || 12 }]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Commands</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            placeholderTextColor="#6a6a6a"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {visibleCommands.length === 0 ? (
            <Text style={styles.empty}>No commands found</Text>
          ) : (
            <FlatList
              data={visibleCommands}
              keyExtractor={(item) => item.name}
              keyboardShouldPersistTaps="always"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => handleSelect(item.name)}
                  activeOpacity={0.6}
                >
                  <View style={styles.rowTop}>
                    <Text style={styles.name}>{`/${item.name}`}</Text>
                    <Text style={styles.scope}>
                      {item.namespace ? `(${item.namespace})` : item.scope}
                    </Text>
                    {usage[item.name] ? (
                      <Text style={styles.count}>{usage[item.name]}</Text>
                    ) : null}
                  </View>
                  {item.description ? (
                    <Text style={styles.description} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              )}
            />
          )}

          {truncated && (
            <Text style={styles.note}>List truncated: too many command files to scan.</Text>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  container: {
    backgroundColor: '#1e1e1e',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    maxHeight: '80%',
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  title: { color: '#d4d4d4', fontSize: 16, fontWeight: '600' },
  closeBtn: { padding: 4 },
  closeText: { color: '#d4d4d4', fontSize: 16 },
  search: {
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    color: '#d4d4d4',
    fontSize: 14,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: '#569cd6', fontSize: 14, fontFamily: 'Menlo', flexShrink: 1 },
  scope: { color: '#6a6a6a', fontSize: 11 },
  count: { color: '#4ec9b0', fontSize: 11, marginLeft: 'auto' },
  description: { color: '#9a9a9a', fontSize: 12, marginTop: 2 },
  empty: { color: '#6a6a6a', fontSize: 13, textAlign: 'center', padding: 24 },
  note: { color: '#dcdcaa', fontSize: 11, paddingHorizontal: 16, paddingTop: 8 },
})
