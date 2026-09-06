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

/**
 * サーバー（command_list の error フィールド）ではなく、モバイル側だけで
 * 判定するローカルなエラーコード。TerminalScreen が commandsError にセットする。
 */
/** session_attached から一定時間 command_list が届かなかった（TerminalScreen 側で判定） */
export const ERROR_CLIENT_TIMEOUT = 'client_timeout'
/** auth_error / shell_exit / session_not_found でセッションが終了した */
export const ERROR_SESSION_ENDED = 'session_ended'

interface Props {
  visible: boolean
  /**
   * command_list_request への応答がまだ届いていない場合は null。
   * 届いていれば、走査結果が空でも配列（空配列を含む）になる。
   */
  commands: SlashCommandInfo[] | null
  truncated?: boolean
  /** command_list の error フィールド。'scan_failed' | 'not_attached' など */
  error?: string | null
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

export function SlashCommandSheet({
  visible,
  commands,
  truncated,
  error,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<Record<string, number>>({})
  const keyboardHeight = useKeyboardHeight()

  useEffect(() => {
    if (!visible) return
    setQuery('')
    loadUsage().then(setUsage)
  }, [visible])

  const visibleCommands = useMemo(() => {
    if (!commands) return []
    const sorted = sortCommands(commands, usage)
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
    )
  }, [commands, usage, query])

  // 一覧本文の状態を「まだ届いていない」「取得失敗」「セッションが終了した」
  // 「応答が来ない（タイムアウト）」「取得できたが空」「表示できる項目がある」に
  // 分ける。エラーは commands の有無より優先する
  // （pty-server は失敗時も commands: [] を送るため）。
  let emptyMessage: string | null = null
  if (error === 'scan_failed') {
    emptyMessage = 'Failed to scan commands'
  } else if (error === 'not_attached') {
    emptyMessage = 'Not attached to a session'
  } else if (error === ERROR_SESSION_ENDED) {
    // auth_error / shell_exit / session_not_found のリセットによるもの。
    // 「見つからない」ではなく「セッションが終了した」ことを伝える
    emptyMessage = 'Session has ended'
  } else if (error === ERROR_CLIENT_TIMEOUT) {
    // 走査に時間がかかっているだけの可能性もあるため、断定はしない
    emptyMessage = "Taking a while to respond. The desktop app may need updating."
  } else if (error) {
    emptyMessage = 'Failed to load commands'
  } else if (commands === null) {
    emptyMessage = 'Loading commands…'
  } else if (visibleCommands.length === 0) {
    emptyMessage = 'No commands found'
  }

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

          {emptyMessage !== null ? (
            <Text style={styles.empty}>{emptyMessage}</Text>
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
