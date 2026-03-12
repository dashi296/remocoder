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
    // 接続試行タイムアウト（ms）: CONNECTINGのまま無応答の場合に切断して再試行
    const CONNECT_TIMEOUT = 10000
    let reconnectAttempt = 0
    let connectTimeoutId = null
    let reconnectTimerId = null
    // 認証エラー・シェル終了後は自動再接続しない
    let noReconnect = false

    function postToNative(data) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(data))
    }

    function connect() {
      if (noReconnect) return

      reconnectAttempt++
      ws = new WebSocket('${wsUrl}')

      // 接続タイムアウト: CONNECTINGのまま応答がない場合
      connectTimeoutId = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
          term.write('\\r\\n[接続タイムアウト。再接続中...]\\r\\n')
          ws.close()
        }
      }, CONNECT_TIMEOUT)

      ws.onopen = () => {
        clearTimeout(connectTimeoutId)
        reconnectDelay = 1000
        reconnectAttempt = 0
        ws.send(JSON.stringify({ type: 'auth', token: '${token}' }))
        postToNative({ type: 'connected' })
      }

      ws.onmessage = (e) => {
        let msg
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }

        if (msg.type === 'output') {
          term.write(msg.data)
        } else if (msg.type === 'auth_ok') {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
          postToNative({ type: 'auth_ok' })
        } else if (msg.type === 'auth_error') {
          term.write('\\r\\n[認証エラー: ' + msg.reason + ']\\r\\n')
          noReconnect = true
          ws.close()
          postToNative({ type: 'auth_error', reason: msg.reason })
        } else if (msg.type === 'shell_exit') {
          term.write('\\r\\n[セッションが終了しました (exit code: ' + msg.exitCode + ')]\\r\\n')
          noReconnect = true
          postToNative({ type: 'shell_exit', exitCode: msg.exitCode })
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
        // pong: keepalive確認、処理不要
      }

      ws.onclose = () => {
        clearTimeout(connectTimeoutId)
        if (noReconnect) return

        const delaySec = reconnectDelay / 1000
        term.write('\\r\\n[切断されました。' + delaySec + '秒後に再接続します... (試行: ' + reconnectAttempt + ')]\\r\\n')
        postToNative({ type: 'disconnected', reconnectDelay })

        reconnectTimerId = setTimeout(() => {
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

    // クライアント側keepalive: サーバーからのpingに加え、クライアントからも定期送信
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
