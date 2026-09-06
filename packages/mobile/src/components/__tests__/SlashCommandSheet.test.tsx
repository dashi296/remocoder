import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SlashCommandInfo } from '@remocoder/shared'
import {
  SlashCommandSheet,
  sortCommands,
  loadUsage,
  recordUsage,
  USAGE_STORAGE_KEY,
} from '../SlashCommandSheet'

/**
 * マウント時の loadUsage().then(setUsage) や、コマンド押下時の
 * recordUsage(name).then(() => loadUsage().then(setUsage)) は
 * 発火してから待たない Promise チェーンであり、これはブリーフで
 * 指定された実装仕様（変更禁止）である。
 *
 * このヘルパーは、そうしたチェーンをテストの act 境界内で確実に
 * 解決させるためのテスト側の後始末。setTimeout はマクロタスクなので、
 * これより前にスケジュールされたマイクロタスク（Promise の then チェーン）は
 * すべて解決してから実行される。act() で包むことで、チェーンの中で
 * 呼ばれる setState も act 警告を出さずに反映される。
 *
 * 呼び出さないと、そのテストが終了した後に前述の Promise が解決し、
 * (1) 別のテストの実行中に "not wrapped in act(...)" 警告が出たり、
 * (2) 次のテストの beforeEach の AsyncStorage.clear() と書き込みが
 *     競合して使用回数が意図せず上書きされたりする可能性がある。
 */
async function flushPendingEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const makeCommand = (overrides: Partial<SlashCommandInfo> = {}): SlashCommandInfo => ({
  name: 'commit',
  description: 'Create a git commit',
  scope: 'user',
  ...overrides,
})

const defaultProps = {
  visible: true,
  commands: [makeCommand()],
  onClose: jest.fn(),
  onSelect: jest.fn(),
}

describe('sortCommands', () => {
  it('使用回数の多い順に並べる', () => {
    const commands = [
      makeCommand({ name: 'a' }),
      makeCommand({ name: 'b' }),
      makeCommand({ name: 'c' }),
    ]
    const sorted = sortCommands(commands, { b: 5, c: 2 })
    expect(sorted.map((c) => c.name)).toEqual(['b', 'c', 'a'])
  })

  it('使用回数が同じなら名前順に並べる', () => {
    const commands = [makeCommand({ name: 'z' }), makeCommand({ name: 'a' })]
    expect(sortCommands(commands, { z: 1, a: 1 }).map((c) => c.name)).toEqual(['a', 'z'])
  })

  it('未使用のコマンドを名前順で後方に置く', () => {
    const commands = [
      makeCommand({ name: 'unused-a' }),
      makeCommand({ name: 'used' }),
      makeCommand({ name: 'unused-b' }),
    ]
    expect(sortCommands(commands, { used: 1 }).map((c) => c.name)).toEqual([
      'used',
      'unused-a',
      'unused-b',
    ])
  })

  it('元の配列を破壊しない', () => {
    const commands = [makeCommand({ name: 'b' }), makeCommand({ name: 'a' })]
    sortCommands(commands, {})
    expect(commands.map((c) => c.name)).toEqual(['b', 'a'])
  })
})

describe('使用回数の永続化', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await AsyncStorage.clear()
  })

  it('recordUsage が回数を1増やす', async () => {
    await recordUsage('commit')
    await recordUsage('commit')
    expect(await loadUsage()).toEqual({ commit: 2 })
  })

  it('loadUsage は未保存のとき空オブジェクトを返す', async () => {
    expect(await loadUsage()).toEqual({})
  })

  it('loadUsage は壊れた JSON でも空オブジェクトを返す', async () => {
    await AsyncStorage.setItem(USAGE_STORAGE_KEY, '{ broken')
    expect(await loadUsage()).toEqual({})
  })

  it('loadUsage は読み取り失敗時に空オブジェクトを返す', async () => {
    // AsyncStorage のモックは jest.fn() で作られているため、jest.spyOn はラップせず
    // 同じモック関数をそのまま返す。そのため mockRestore() を呼ぶと「元の実装」が
    // 存在せず、生成時の実装ごとリセットされてしまう（以降 undefined を返す関数になる）。
    // mockRejectedValueOnce は1回限りの上書きなので、明示的な復元は不要かつ有害。
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('fail'))
    expect(await loadUsage()).toEqual({})
  })

  it('recordUsage は書き込み失敗時に例外を投げない', async () => {
    // 上と同じ理由で mockRestore() は呼ばない
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('fail'))
    await expect(recordUsage('commit')).resolves.toBeUndefined()
  })
})

describe('SlashCommandSheet', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await AsyncStorage.clear()
  })

  it('visible=false のとき中身を描画しない', () => {
    render(<SlashCommandSheet {...defaultProps} visible={false} />)
    expect(screen.queryByText('Commands')).toBeNull()
  })

  it('visible=true のときタイトルを表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(screen.getByText('Commands')).toBeTruthy()
    await flushPendingEffects()
  })

  it('コマンド名を先頭の / 付きで表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(await screen.findByText('/commit')).toBeTruthy()
    await flushPendingEffects()
  })

  it('description を表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(await screen.findByText('Create a git commit')).toBeTruthy()
    await flushPendingEffects()
  })

  it('scope を表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    expect(await screen.findByText('user')).toBeTruthy()
    await flushPendingEffects()
  })

  it('namespace があれば (namespace) 形式で表示し scope は表示しない', async () => {
    const commands = [
      makeCommand({ name: 'build', scope: 'project', namespace: 'project:ci' }),
    ]
    render(<SlashCommandSheet {...defaultProps} commands={commands} />)
    expect(await screen.findByText('(project:ci)')).toBeTruthy()
    expect(screen.queryByText('project')).toBeNull()
    await flushPendingEffects()
  })

  it('コマンド名で絞り込む', async () => {
    const commands = [makeCommand({ name: 'commit' }), makeCommand({ name: 'review' })]
    render(<SlashCommandSheet {...defaultProps} commands={commands} />)
    fireEvent.changeText(screen.getByPlaceholderText('Search…'), 'rev')
    await waitFor(() => expect(screen.queryByText('/commit')).toBeNull())
    expect(screen.getByText('/review')).toBeTruthy()
    await flushPendingEffects()
  })

  it('description で絞り込む', async () => {
    const commands = [
      makeCommand({ name: 'a', description: 'git commit helper' }),
      makeCommand({ name: 'b', description: 'unrelated' }),
    ]
    render(<SlashCommandSheet {...defaultProps} commands={commands} />)
    fireEvent.changeText(screen.getByPlaceholderText('Search…'), 'git')
    await waitFor(() => expect(screen.queryByText('/b')).toBeNull())
    expect(screen.getByText('/a')).toBeTruthy()
    await flushPendingEffects()
  })

  it('大文字小文字を区別せず絞り込む', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    fireEvent.changeText(screen.getByPlaceholderText('Search…'), 'COMMIT')
    expect(await screen.findByText('/commit')).toBeTruthy()
    await flushPendingEffects()
  })

  it('コマンドを押すと onSelect が名前で呼ばれる', async () => {
    const onSelect = jest.fn()
    render(<SlashCommandSheet {...defaultProps} onSelect={onSelect} />)
    fireEvent.press(await screen.findByText('/commit'))
    expect(onSelect).toHaveBeenCalledWith('commit')
    // handleSelect が発火した recordUsage(...).then(() => loadUsage().then(setUsage))
    // をこのテストの act 境界内で解決させ、次のテストへ持ち越さない
    await flushPendingEffects()
  })

  it('コマンドを押すと使用回数が記録される', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    fireEvent.press(await screen.findByText('/commit'))
    await waitFor(async () => expect(await loadUsage()).toEqual({ commit: 1 }))
    await flushPendingEffects()
  })

  it('閉じるボタンで onClose が呼ばれる', async () => {
    const onClose = jest.fn()
    render(<SlashCommandSheet {...defaultProps} onClose={onClose} />)
    fireEvent.press(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalled()
    await flushPendingEffects()
  })

  it('truncated のとき打ち切りの注記を表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} truncated />)
    expect(await screen.findByText(/truncated/i)).toBeTruthy()
    await flushPendingEffects()
  })

  it('キーボード非表示時は下部パディングが 0 に潰れない', async () => {
    render(<SlashCommandSheet {...defaultProps} />)
    const container = screen.getByTestId('slash-command-sheet-container')
    // このプロジェクトの RN テスト環境では StyleSheet.flatten がモックされており
    // 配列をそのまま返すだけなので、ここでは手動でマージして最終的な値を確認する
    const merged = Object.assign({}, ...([] as unknown[]).concat(container.props.style))
    expect(merged.paddingBottom).toBe(12)
    await flushPendingEffects()
  })

  it('コマンドが空のとき空状態を表示する', async () => {
    render(<SlashCommandSheet {...defaultProps} commands={[]} />)
    expect(screen.getByText('No commands found')).toBeTruthy()
    await flushPendingEffects()
  })

  it('保存済みの使用回数の順に並べて表示する', async () => {
    await AsyncStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ review: 3 }))
    const commands = [makeCommand({ name: 'commit' }), makeCommand({ name: 'review' })]
    render(<SlashCommandSheet {...defaultProps} commands={commands} />)
    const items = await screen.findAllByText(/^\//)
    expect(items[0].props.children).toBe('/review')
    await flushPendingEffects()
  })
})
