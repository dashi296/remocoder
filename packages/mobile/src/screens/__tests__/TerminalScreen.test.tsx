import React from 'react'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react-native'
import { TerminalScreen } from '../TerminalScreen'
import { injectJavaScriptMock } from '../../__mocks__/react-native-webview'
import { useLocalSearchParams, mockRouterBack } from '../../__mocks__/expo-router'

describe('TerminalScreen', () => {
  // WebView から onMessage を発火するヘルパー
  function sendFromWebView(msg: object) {
    const webViewEl = screen.getByTestId('webview')
    act(() => {
      webViewEl.props.onMessage({ nativeEvent: { data: JSON.stringify(msg) } })
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    injectJavaScriptMock.mockClear()
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      ip: '100.64.0.1',
      token: 'test-token',
    })
  })

  // このプロジェクトの jest.config.js は @testing-library/react-native の
  // jest-preset を使っておらず、テスト間の自動 unmount が行われない。
  // TerminalScreen は session_attached のたびに実タイマー（5秒）を張るため、
  // 明示的に unmount してエフェクトのクリーンアップ（clearCommandTimeout）を
  // 走らせないと、そのタイマーが後続のテスト実行中に非同期で発火し、
  // 「act(...) でラップされていない」という警告を引き起こす
  afterEach(() => {
    cleanup()
  })

  it('WebView が render される', () => {
    render(<TerminalScreen />)
    expect(screen.getByTestId('webview')).toBeTruthy()
  })

  it('初期状態で「Connecting...」ステータスが表示される', () => {
    render(<TerminalScreen />)
    expect(screen.getByText('Connecting...')).toBeTruthy()
  })

  it('session_attached メッセージ → 「Connected」ステータスに変わる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'session_attached', sessionId: 'test-session', scrollback: '' })
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('disconnected メッセージ → 「Reconnecting...」ステータスに変わる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'disconnected' })
    expect(screen.getByText('Reconnecting...')).toBeTruthy()
  })

  it('auth_error メッセージ → 「Auth Error」ステータスと「Retry」ボタンが表示される', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    expect(screen.getByText('Auth Error')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('shell_exit メッセージ → 「Session Ended」ステータスと「Retry」ボタンが表示される', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'shell_exit', exitCode: 0 })
    expect(screen.getByText('Session Ended')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('不正な JSON でも throw しない', () => {
    render(<TerminalScreen />)
    const webViewEl = screen.getByTestId('webview')
    expect(() => {
      act(() => {
        webViewEl.props.onMessage({ nativeEvent: { data: 'not-json' } })
      })
    }).not.toThrow()
  })

  it('source パラメータが不正な JSON でも throw しない', () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      ip: '100.64.0.1',
      token: 'test-token',
      source: 'invalid-json{',
    })
    expect(() => render(<TerminalScreen />)).not.toThrow()
  })

  it('Disconnect ボタン押下で router.back() が呼ばれる', () => {
    render(<TerminalScreen />)
    fireEvent.press(screen.getByText('Disconnect'))
    expect(mockRouterBack).toHaveBeenCalled()
  })

  it('Retry ボタン押下でステータスが「Connecting...」に戻る', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'auth_error', reason: 'invalid token' })
    fireEvent.press(screen.getByText('Retry'))
    expect(screen.getByText('Connecting...')).toBeTruthy()
    expect(mockRouterBack).not.toHaveBeenCalled()
  })

  it('session_not_found 受信後に auth_error ステータスになる', () => {
    render(<TerminalScreen />)
    sendFromWebView({ type: 'session_attached', sessionId: 'sid-1', scrollback: '' })
    sendFromWebView({ type: 'session_not_found', sessionId: 'sid-gone' })

    expect(screen.getByText('Auth Error')).toBeTruthy()
  })

  describe('PermissionSheet', () => {
    it('permission_request を受信すると PermissionSheet が表示される', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-001',
        toolName: 'Bash',
        details: ['rm -rf /tmp/test'],
        requiresAlways: true,
      })

      expect(screen.getByText('Permission Request')).toBeTruthy()
      expect(screen.getByText('Bash')).toBeTruthy()
      expect(screen.getByText('rm -rf /tmp/test')).toBeTruthy()
      expect(screen.getByText('Allow')).toBeTruthy()
      expect(screen.getByText('Deny')).toBeTruthy()
      expect(screen.getByText('Always Allow')).toBeTruthy()
    })

    it('requiresAlways=false のとき「常に許可」ボタンが表示されない', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-002',
        toolName: 'Write',
        details: ['/tmp/file.ts'],
        requiresAlways: false,
      })

      expect(screen.getByText('Allow')).toBeTruthy()
      expect(screen.getByText('Deny')).toBeTruthy()
      expect(screen.queryByText('Always Allow')).toBeNull()
    })

    it('「許可」を押すと sendPermissionResponse が injectJavaScript で呼ばれ、シートが閉じる', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-003',
        toolName: 'Bash',
        details: [],
        requiresAlways: false,
      })

      fireEvent.press(screen.getByText('Allow'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-003", "approve")'),
      )
      expect(screen.queryByText('Permission Request')).toBeNull()
    })

    it('「拒否」を押すと reject decision が送られ、シートが閉じる', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-004',
        toolName: 'Bash',
        details: [],
        requiresAlways: false,
      })

      fireEvent.press(screen.getByText('Deny'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-004", "reject")'),
      )
      expect(screen.queryByText('Permission Request')).toBeNull()
    })

    it('「常に許可」を押すと always decision が送られる', () => {
      render(<TerminalScreen />)
      sendFromWebView({
        type: 'permission_request',
        requestId: 'req-005',
        toolName: 'Bash',
        details: [],
        requiresAlways: true,
      })

      fireEvent.press(screen.getByText('Always Allow'))

      expect(injectJavaScriptMock).toHaveBeenCalledWith(
        expect.stringContaining('window.sendPermissionResponse("req-005", "always")'),
      )
    })
  })

  describe('スラッシュコマンドシート', () => {
    /**
     * シートを開く。SlashCommandSheet は visible になるたびに
     * loadUsage()（AsyncStorage 読み取り、モックでは非同期に解決する）を呼ぶため、
     * fireEvent.press 直後に同期的な assertion を続けると、その解決が
     * act(...) の外側で起きて「not wrapped in act」警告が出る。
     * ここで1tick 分 flush してから返す
     */
    async function openSheet(): Promise<void> {
      fireEvent.press(screen.getByTestId('slash-command-button'))
      await act(async () => {})
    }

    /** injectJavaScript に渡された全スクリプトを1つの文字列にまとめる */
    function injectedText(): string {
      return injectJavaScriptMock.mock.calls.map((c) => String(c[0])).join('\n')
    }

    it('claude セッションではコマンドボタンを表示する', () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      expect(screen.getByTestId('slash-command-button')).toBeTruthy()
    })

    it('shell セッションではコマンドボタンを表示しない', () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'shell' } })
      expect(screen.queryByTestId('slash-command-button')).toBeNull()
    })

    it('session_attached を受けると requestCommandList を注入する', () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      expect(injectedText()).toContain('requestCommandList')
    })

    it('command_list を受け取るとシートに反映する', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      sendFromWebView({
        type: 'command_list',
        sessionId: 's1',
        commands: [{ name: 'commit', description: 'Create a git commit', scope: 'user' }],
      })
      fireEvent.press(screen.getByTestId('slash-command-button'))
      expect(await screen.findByText('/commit')).toBeTruthy()
    })

    it('command_list の応答が届く前は「読み込み中」を表示し「見つからない」とは表示しない', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      // command_list はまだ送っていない
      await openSheet()
      expect(screen.getByText('Loading commands…')).toBeTruthy()
      expect(screen.queryByText('No commands found')).toBeNull()
    })

    it('command_list が error: scan_failed で返ると走査失敗を表示する', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      sendFromWebView({
        type: 'command_list',
        sessionId: 's1',
        commands: [],
        error: 'scan_failed',
      })
      fireEvent.press(screen.getByTestId('slash-command-button'))
      expect(await screen.findByText('Failed to scan commands')).toBeTruthy()
      expect(screen.queryByText('No commands found')).toBeNull()
    })

    it('command_list が空だが成功で返ると「見つからない」を表示する', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      sendFromWebView({
        type: 'command_list',
        sessionId: 's1',
        commands: [],
      })
      fireEvent.press(screen.getByTestId('slash-command-button'))
      expect(await screen.findByText('No commands found')).toBeTruthy()
    })

    it('コマンドを選ぶと sendInput を注入してシートを閉じる', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      sendFromWebView({
        type: 'command_list',
        sessionId: 's1',
        commands: [{ name: 'commit', scope: 'user' }],
      })
      fireEvent.press(screen.getByTestId('slash-command-button'))
      fireEvent.press(await screen.findByText('/commit'))

      expect(injectedText()).toContain('sendInput("/commit")')
      await waitFor(() => expect(screen.queryByText('Commands')).toBeNull())
    })

    it('shell_exit を受けるとシートが閉じる', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      sendFromWebView({
        type: 'command_list',
        sessionId: 's1',
        commands: [{ name: 'commit', scope: 'user' }],
      })
      fireEvent.press(screen.getByTestId('slash-command-button'))
      expect(await screen.findByText('/commit')).toBeTruthy()

      sendFromWebView({ type: 'shell_exit', exitCode: 0 })

      expect(screen.queryByText('Commands')).toBeNull()
    })

    it('session_not_found を受けるとコマンド一覧がリセットされ、再度開くと「セッション終了」状態になる', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      sendFromWebView({
        type: 'command_list',
        sessionId: 's1',
        commands: [{ name: 'commit', scope: 'user' }],
      })
      fireEvent.press(screen.getByTestId('slash-command-button'))
      expect(await screen.findByText('/commit')).toBeTruthy()

      sendFromWebView({ type: 'session_not_found', sessionId: 's1' })
      expect(screen.queryByText('Commands')).toBeNull()

      // シートを開き直しても、死んだセッションのコマンド一覧を選ばせない。
      // 「見つからない（0件）」ではなく「セッションが終了した」ことを表示する
      fireEvent.press(screen.getByTestId('slash-command-button'))
      expect(await screen.findByText('Session has ended')).toBeTruthy()
      expect(screen.queryByText('No commands found')).toBeNull()
      expect(screen.queryByText('/commit')).toBeNull()
    })

    it('auth_error を受けるとコマンド一覧がリセットされ「セッション終了」状態になる', async () => {
      render(<TerminalScreen />)
      sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
      sendFromWebView({
        type: 'command_list',
        sessionId: 's1',
        commands: [{ name: 'commit', scope: 'user' }],
      })

      sendFromWebView({ type: 'auth_error', reason: 'invalid token' })

      fireEvent.press(screen.getByTestId('slash-command-button'))
      expect(await screen.findByText('Session has ended')).toBeTruthy()
      expect(screen.queryByText('No commands found')).toBeNull()
      expect(screen.queryByText('/commit')).toBeNull()
    })

    describe('command_list_request のタイムアウト（Finding 2）', () => {
      beforeEach(() => {
        jest.useFakeTimers()
      })

      afterEach(() => {
        jest.useRealTimers()
      })

      it('session_attached から5秒経っても command_list が届かなければ、デスクトップの更新が必要かもしれないと表示する', async () => {
        render(<TerminalScreen />)
        sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
        // command_list はまだ送っていない

        await openSheet()
        expect(screen.getByText('Loading commands…')).toBeTruthy()

        await act(async () => {
          jest.advanceTimersByTime(5000)
        })

        expect(
          screen.getByText('Taking a while to respond. The desktop app may need updating.'),
        ).toBeTruthy()
        expect(screen.queryByText('Loading commands…')).toBeNull()
      })

      it('タイムアウト前に command_list が届けば、タイムアウト表示にならない', async () => {
        render(<TerminalScreen />)
        sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
        sendFromWebView({
          type: 'command_list',
          sessionId: 's1',
          commands: [{ name: 'commit', scope: 'user' }],
        })

        await act(async () => {
          jest.advanceTimersByTime(5000)
        })

        await openSheet()
        expect(
          screen.queryByText('Taking a while to respond. The desktop app may need updating.'),
        ).toBeNull()
      })

      it('新しい session_attached を受けるとタイマーが張り直される（古いタイマーでは発火しない）', async () => {
        render(<TerminalScreen />)
        sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })

        await act(async () => {
          jest.advanceTimersByTime(4000)
        })
        // 別セッションへ再アタッチ（例: Retry 後）。タイマーは張り直される
        sendFromWebView({ type: 'session_attached', sessionId: 's2', source: { kind: 'claude' } })

        await act(async () => {
          jest.advanceTimersByTime(4000)
        })
        // 新しいタイマーからはまだ4秒しか経っていないので発火しない
        await openSheet()
        expect(screen.getByText('Loading commands…')).toBeTruthy()

        await act(async () => {
          jest.advanceTimersByTime(1000)
        })
        expect(
          screen.getByText('Taking a while to respond. The desktop app may need updating.'),
        ).toBeTruthy()
      })

      it('タイムアウトが発火する前に shell_exit を受けると、後からタイムアウト表示に上書きされない', async () => {
        // session_attached でタイマーが張られた後、走査を待たずにセッションが
        // 終了した場合、resetCommandState がタイマーをクリアしないと、
        // 後から発火したタイムアウトが「セッション終了」表示を
        // 「デスクトップの更新が必要かも」に上書きしてしまう
        render(<TerminalScreen />)
        sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })

        await act(async () => {
          jest.advanceTimersByTime(2000)
        })
        sendFromWebView({ type: 'shell_exit', exitCode: 0 })

        await act(async () => {
          jest.advanceTimersByTime(5000)
        })

        await openSheet()
        expect(screen.getByText('Session has ended')).toBeTruthy()
        expect(
          screen.queryByText('Taking a while to respond. The desktop app may need updating.'),
        ).toBeNull()
      })
    })

    describe('command_list の sessionId 照合（Finding 4）', () => {
      it('前のセッション宛ての command_list は無視される', async () => {
        render(<TerminalScreen />)
        sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })
        sendFromWebView({ type: 'session_attached', sessionId: 's2', source: { kind: 'claude' } })

        // s1 宛ての遅延応答が s2 にアタッチした後に届く
        sendFromWebView({
          type: 'command_list',
          sessionId: 's1',
          commands: [{ name: 'stale-command', scope: 'user' }],
        })

        await openSheet()
        expect(screen.getByText('Loading commands…')).toBeTruthy()
        expect(screen.queryByText('/stale-command')).toBeNull()

        // s2 宛ての応答は反映される
        sendFromWebView({
          type: 'command_list',
          sessionId: 's2',
          commands: [{ name: 'current-command', scope: 'user' }],
        })
        expect(await screen.findByText('/current-command')).toBeTruthy()
      })

      it('sessionId: null の not_attached は現在のセッションと無関係に反映される', async () => {
        render(<TerminalScreen />)
        sendFromWebView({ type: 'session_attached', sessionId: 's1', source: { kind: 'claude' } })

        sendFromWebView({
          type: 'command_list',
          sessionId: null,
          commands: [],
          error: 'not_attached',
        })

        await openSheet()
        expect(await screen.findByText('Not attached to a session')).toBeTruthy()
      })
    })
  })
})
