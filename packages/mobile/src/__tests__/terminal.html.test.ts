import { buildTerminalHtml } from '../assets/terminalHtml'

describe('buildTerminalHtml', () => {
  const wsUrl = 'ws://100.64.0.1:8080'
  const token = 'my-secret-token'

  describe('基本パラメータの埋め込み', () => {
    let html: string

    beforeEach(() => {
      html = buildTerminalHtml(wsUrl, token)
    })

    it('wsUrl が HTML に埋め込まれる', () => {
      expect(html).toContain(wsUrl)
    })

    it('token が HTML に埋め込まれる', () => {
      expect(html).toContain(token)
    })

    it('xterm.js の script タグが含まれる', () => {
      expect(html).toContain('xterm')
      expect(html).toContain('<script')
    })

    it('auth メッセージ送信ロジックが含まれる', () => {
      expect(html).toContain("type: 'auth'")
    })

    it('指数バックオフの初期値 1000ms が含まれる', () => {
      expect(html).toContain('1000')
    })

    it('指数バックオフの最大値 30000ms が含まれる', () => {
      expect(html).toContain('30000')
    })

    it('auth_error 時に ReactNativeWebView.postMessage を呼ぶ記述が含まれる', () => {
      expect(html).toContain('ReactNativeWebView')
      expect(html).toContain('postMessage')
    })

    it('接続タイムアウト (CONNECT_TIMEOUT) の記述が含まれる', () => {
      expect(html).toContain('CONNECT_TIMEOUT')
      expect(html).toContain('10000')
    })

    it('shell_exit メッセージのハンドラが含まれる', () => {
      expect(html).toContain('shell_exit')
    })

    it('noReconnect フラグの記述が含まれる', () => {
      expect(html).toContain('noReconnect')
    })
  })

  describe('セッション選択プロトコル', () => {
    it('projectPath が null の場合 session_create を送信するロジックが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token, null)
      expect(html).toContain('session_create')
      expect(html).toContain('PROJECT_PATH')
    })

    it('projectPath が指定された場合 session_create に projectPath が含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token, '/Users/john/myproject')
      expect(html).toContain('session_create')
      expect(html).toContain('/Users/john/myproject')
    })

    it('session_attached メッセージのハンドラが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('session_attached')
    })

    it('scrollback の書き込みロジックが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('scrollback')
    })

    it('session_attached 受信時に term.reset() を呼ぶ記述が含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('term.reset()')
    })
  })

  describe('sessionId パラメータ（既存セッションへのアタッチ）', () => {
    it('sessionId が null の場合 ATTACH_SESSION_ID が null として埋め込まれる', () => {
      const html = buildTerminalHtml(wsUrl, token, null, null)
      expect(html).toContain('const ATTACH_SESSION_ID = null')
    })

    it('sessionId が指定された場合 ATTACH_SESSION_ID に JSON 文字列として埋め込まれる', () => {
      const sessionId = 'abc-123-def'
      const html = buildTerminalHtml(wsUrl, token, null, sessionId)
      expect(html).toContain(`const ATTACH_SESSION_ID = ${JSON.stringify(sessionId)}`)
    })

    it('sessionId が指定された場合 session_attach を送信するロジックが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token, null, 'some-session-id')
      expect(html).toContain('session_attach')
      expect(html).toContain('ATTACH_SESSION_ID')
    })

    it('sessionId が指定された場合 session_create と session_attach の両方の分岐が含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token, null, 'some-session-id')
      expect(html).toContain('session_attach')
      expect(html).toContain('session_create')
    })
  })

  describe('セッション切替ブリッジ関数', () => {
    it('window.requestSessionList が含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('window.requestSessionList')
      expect(html).toContain('session_list_request')
    })

    it('window.switchToSession が含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('window.switchToSession')
      expect(html).toContain('session_attach')
    })

    it('window.createNewSession が含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('window.createNewSession')
      expect(html).toContain('session_create')
    })

    it('createNewSession は noReconnect を false にリセットする', () => {
      const html = buildTerminalHtml(wsUrl, token)
      // createNewSession 内に noReconnect = false がある
      const fnStart = html.indexOf('window.createNewSession')
      const fnBody = html.slice(fnStart, fnStart + 300)
      expect(fnBody).toContain('noReconnect = false')
    })

    it('session_list_response を受信したとき postToNative を呼ぶ記述が含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('session_list_response')
      expect(html).toContain('postToNative')
    })
  })
})
