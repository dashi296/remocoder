export function buildTerminalHtml(wsUrl: string, token: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <script src="https://cdn.jsdelivr.net/npm/xterm@5/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8/lib/xterm-addon-fit.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5/css/xterm.css"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #1e1e1e; overflow: hidden; }
    #terminal { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    const term = new Terminal({
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 1000,
    })
    const fitAddon = new FitAddon.FitAddon()
    term.loadAddon(fitAddon)
    term.open(document.getElementById('terminal'))
    fitAddon.fit()

    let ws = null
    let reconnectDelay = 1000
    const MAX_RECONNECT_DELAY = 30000

    function connect() {
      ws = new WebSocket('${wsUrl}')

      ws.onopen = () => {
        reconnectDelay = 1000
        ws.send(JSON.stringify({ type: 'auth', token: '${token}' }))
      }

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'output') term.write(msg.data)
        if (msg.type === 'auth_ok') {
          // 認証成功後にサイズを送信
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }
        if (msg.type === 'auth_error') {
          term.write('\\r\\n[認証エラー: ' + msg.reason + ']\\r\\n')
          ws.close()
          // 認証エラー時は再接続しない
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'auth_error', reason: msg.reason }))
        }
        if (msg.type === 'pong') {
          // keepalive確認
        }
      }

      ws.onclose = () => {
        term.write('\\r\\n[接続が切断されました。再接続中... (' + (reconnectDelay / 1000) + 's)]\\r\\n')
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'disconnected' }))
        setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
          connect()
        }, reconnectDelay)
      }

      ws.onerror = () => {
        // onclose が続いて呼ばれるので再接続はそちらで処理
      }
    }

    connect()

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    window.addEventListener('resize', () => {
      fitAddon.fit()
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })

    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  </script>
</body>
</html>
`
}
