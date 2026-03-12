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
    it('sessionId が null の場合 session_create を送信するロジックが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token, null)
      expect(html).toContain('session_create')
      expect(html).toContain('TARGET_SESSION_ID')
    })

    it('sessionId が指定された場合 session_attach を送信するロジックが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token, 'my-session-id')
      expect(html).toContain('session_attach')
      expect(html).toContain('my-session-id')
    })

    it('session_attached メッセージのハンドラが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('session_attached')
    })

    it('session_not_found メッセージのハンドラが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('session_not_found')
    })

    it('scrollback の書き込みロジックが含まれる', () => {
      const html = buildTerminalHtml(wsUrl, token)
      expect(html).toContain('scrollback')
    })
  })
})
