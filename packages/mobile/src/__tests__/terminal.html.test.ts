import { buildTerminalHtml } from '../assets/terminal.html'

describe('buildTerminalHtml', () => {
  const wsUrl = 'ws://100.64.0.1:8080'
  const token = 'my-secret-token'
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
})
