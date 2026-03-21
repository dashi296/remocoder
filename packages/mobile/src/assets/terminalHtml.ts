import type { SessionSource } from '@remocoder/shared'

/**
 * @param wsUrl WebSocket URL
 * @param token 認証トークン
 * @param projectPath セッションを起動するプロジェクトパス。null の場合はプロジェクトなし
 * @param sessionId 既存セッションにアタッチする場合のセッションID。指定時は session_attach を送信
 * @param source セッション起動元。指定時は projectPath より優先して session_create の source フィールドに使用
 */
export function buildTerminalHtml(
  wsUrl: string,
  token: string,
  projectPath: string | null = null,
  sessionId: string | null = null,
  source: SessionSource | null = null,
): string {
  const projectPathJs = projectPath ? JSON.stringify(projectPath) : 'null'
  const sessionIdJs = sessionId ? JSON.stringify(sessionId) : 'null'
  const sourceJs = source ? JSON.stringify(source) : 'null'

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

    // セッション切替に追従して現在のセッションソースを保持する
    let currentSource = null

    // タッチスクロールのハンドリング（慣性スクロール付き）
    // capture: true で xterm.js より先にイベントを取得し、iOS WebView のジェスチャー横取りを回避する
    ;(function setupTouchScroll() {
      let lastY = 0
      let lastMoveTime = 0
      let velocityPxMs = 0   // px/ms（正 = 上スワイプ方向）
      let scrollAccum = 0
      let momentumId = null
      let isTouching = false  // 指が触れているか（Android多重touchstart対策）

      function cancelMomentum() {
        if (momentumId !== null) { cancelAnimationFrame(momentumId); momentumId = null }
      }

      function getScrollTarget() {
        const bufType = term.buffer && term.buffer.active && term.buffer.active.type
        const src = currentSource || SESSION_SOURCE
        const isMultiplexer = src &&
          (src.kind === 'tmux' || src.kind === 'screen' || src.kind === 'zellij')
        return { bufType, isMultiplexer }
      }

      function applyScroll(deltaY, scrollTarget) {
        const { bufType, isMultiplexer } = scrollTarget || getScrollTarget()
        if (bufType === 'alternate' || isMultiplexer) {
          // tmux等: SGRマウスシーケンスを直接送信
          // 上スワイプ(deltaY>0)=新しい内容へ=ホイールダウン(65)
          // 下スワイプ(deltaY<0)=古い内容へ=ホイールアップ(64)
          const steps = Math.max(1, Math.min(5, Math.round(Math.abs(deltaY) / 30)))
          const seq = deltaY > 0 ? '\\x1b[<65;1;1M' : '\\x1b[<64;1;1M'
          for (let i = 0; i < steps; i++) sendWs({ type: 'input', data: seq })
        } else {
          // 通常スクリーン: xterm.js スクロールバック（10px = 1ライン）
          scrollAccum += deltaY / 10
          const lines = Math.trunc(scrollAccum)
          scrollAccum -= lines
          if (lines !== 0) {
            term.scrollLines(lines)
          }
        }
      }

      // capture:true で xterm.js より先にイベントを捕捉する
      document.addEventListener('touchstart', function(e) {
        cancelMomentum()
        // isTouching=true のときは Android の多重 touchstart のため state を保持する
        if (!isTouching) {
          velocityPxMs = 0
          scrollAccum = 0
          lastMoveTime = Date.now()
        }
        lastY = e.touches[0].clientY
        isTouching = true
      }, { capture: true, passive: true })

      document.addEventListener('touchmove', function(e) {
        const currentY = e.touches[0].clientY
        const now = Date.now()
        const deltaY = lastY - currentY
        const dt = Math.max(1, now - lastMoveTime)
        // 指数移動平均でvelocityを平滑化
        velocityPxMs = velocityPxMs * 0.6 + (deltaY / dt) * 0.4
        lastY = currentY
        lastMoveTime = now
        if (e.cancelable) e.preventDefault()
        if (Math.abs(deltaY) >= 1) applyScroll(deltaY)
      }, { capture: true, passive: false })

      document.addEventListener('touchend', function(e) {
        // まだ他の指が触れている場合は終了しない
        if (e.touches.length > 0) return
        isTouching = false

        // SGR(tmux等)では慣性スクロールしない
        const scrollTarget = getScrollTarget()
        if (scrollTarget.bufType === 'alternate' || scrollTarget.isMultiplexer) return
        if (Math.abs(velocityPxMs) < 0.3) return

        const FRICTION = 0.90   // フレームごとの減衰率
        const STOP_THRESHOLD = 0.15  // px/ms 以下で停止

        // requestAnimationFrame の実経過時間を使って frame rate 非依存にする
        let prevTimestamp = null
        function frame(timestamp) {
          const frameDt = prevTimestamp ? Math.min(64, timestamp - prevTimestamp) : 16
          prevTimestamp = timestamp
          velocityPxMs *= FRICTION
          if (Math.abs(velocityPxMs) < STOP_THRESHOLD) { momentumId = null; return }
          applyScroll(velocityPxMs * frameDt, scrollTarget)
          momentumId = requestAnimationFrame(frame)
        }
        momentumId = requestAnimationFrame(frame)
      }, { capture: true, passive: true })
    })()

    // セッションを起動するプロジェクトパス（null = プロジェクトなし）
    const PROJECT_PATH = ${projectPathJs}
    // アタッチ先の既存セッションID（null = 新規作成）
    const ATTACH_SESSION_ID = ${sessionIdJs}
    // セッション起動元（null = projectPath を使用）
    const SESSION_SOURCE = ${sourceJs}

    // 接続間でセッションIDを維持して再接続時に再アタッチする
    let currentSessionId = ATTACH_SESSION_ID
    // ユーザーが明示的に選択したセッションかどうか（なければ自動作成）
    const isUserSelectedSession = !!ATTACH_SESSION_ID
    let ws = null
    let reconnectDelay = 1000
    const MAX_RECONNECT_DELAY = 30000
    // 接続試行タイムアウト（ms）
    const CONNECT_TIMEOUT = 10000
    let reconnectAttempt = 0
    let connectTimeoutId = null
    let reconnectTimerId = null
    let keepaliveIntervalId = null
    // 認証エラー・シェル終了後は自動再接続しない
    let noReconnect = false

    function postToNative(data) {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(data))
    }

    /** WebSocket が OPEN のときのみ msg を JSON 送信する */
    function sendWs(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      }
    }

    /** session_create メッセージを構築する */
    function buildSessionCreate(path) {
      if (SESSION_SOURCE) {
        return { type: 'session_create', source: SESSION_SOURCE }
      }
      if (path) {
        return { type: 'session_create', projectPath: path }
      }
      return { type: 'session_create' }
    }

    function stopKeepalive() {
      if (keepaliveIntervalId !== null) {
        clearInterval(keepaliveIntervalId)
        keepaliveIntervalId = null
      }
    }

    function connect() {
      if (noReconnect) return

      // 前の再接続タイマー・接続タイムアウトをキャンセル
      clearTimeout(reconnectTimerId)
      clearTimeout(connectTimeoutId)

      reconnectAttempt++
      postToNative({ type: 'debug', msg: 'connecting to: ${wsUrl}' })
      const currentWs = new WebSocket('${wsUrl}')
      ws = currentWs
      postToNative({ type: 'debug', msg: 'ws created, readyState: ' + ws.readyState })

      // 接続タイムアウト: CONNECTINGのまま応答がない場合
      connectTimeoutId = setTimeout(() => {
        if (currentWs.readyState === WebSocket.CONNECTING) {
          term.write('\\r\\n[接続タイムアウト。再接続中...]\\r\\n')
          currentWs.close()
        }
      }, CONNECT_TIMEOUT)

      currentWs.onopen = () => {
        clearTimeout(connectTimeoutId)
        reconnectDelay = 1000
        reconnectAttempt = 0
        currentWs.send(JSON.stringify({ type: 'auth', token: '${token}' }))
        postToNative({ type: 'connected' })
      }

      currentWs.onmessage = (e) => {
        let msg
        try {
          msg = JSON.parse(e.data)
        } catch {
          return
        }

        if (msg.type === 'output') {
          term.write(msg.data)
        } else if (msg.type === 'auth_ok') {
          // auth_ok を受信後、既存セッションにアタッチするか新規作成する
          if (currentSessionId) {
            currentWs.send(JSON.stringify({ type: 'session_attach', sessionId: currentSessionId }))
          } else {
            currentWs.send(JSON.stringify(buildSessionCreate(PROJECT_PATH)))
          }
        } else if (msg.type === 'session_attached') {
          // セッション切替時はターミナルをリセットしてスクロールバックを書き込む
          term.reset()
          if (msg.scrollback) {
            term.write(msg.scrollback)
          }
          // 現在のセッションソースをスクロール判定用に更新
          currentSource = msg.source || null
          currentSessionId = msg.sessionId
          // リサイズ通知
          currentWs.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
          postToNative({ type: 'session_attached', sessionId: msg.sessionId })
        } else if (msg.type === 'session_not_found') {
          term.write('\\r\\n[セッションが見つかりません: ' + msg.sessionId + '. 新規セッションを作成します...]\\r\\n')
          if (isUserSelectedSession) {
            // ユーザーが明示的に選択したセッションが消えた場合はエラーにする
            noReconnect = true
            stopKeepalive()
            currentWs.close()
            postToNative({ type: 'session_not_found', sessionId: msg.sessionId })
          } else {
            // 自動作成セッションが消えた場合（サーバー再起動等）は新規作成する
            currentSessionId = null
            currentWs.send(JSON.stringify(buildSessionCreate(PROJECT_PATH)))
          }
        } else if (msg.type === 'auth_error') {
          term.write('\\r\\n[認証エラー: ' + msg.reason + ']\\r\\n')
          noReconnect = true
          stopKeepalive()
          currentWs.close()
          postToNative({ type: 'auth_error', reason: msg.reason })
        } else if (msg.type === 'shell_exit') {
          term.write('\\r\\n[セッションが終了しました (exit code: ' + msg.exitCode + ')]\\r\\n')
          noReconnect = true
          stopKeepalive()
          currentWs.close()
          postToNative({ type: 'shell_exit', exitCode: msg.exitCode })
        } else if (msg.type === 'session_list_response') {
          postToNative({ type: 'session_list_response', sessions: msg.sessions, projects: msg.projects })
        } else if (msg.type === 'permission_request') {
          postToNative({
            type: 'permission_request',
            requestId: msg.requestId,
            toolName: msg.toolName,
            details: msg.details,
            requiresAlways: msg.requiresAlways,
          })
        } else if (msg.type === 'ping') {
          currentWs.send(JSON.stringify({ type: 'pong' }))
        }
        // pong: keepalive確認、処理不要
      }

      currentWs.onclose = () => {
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

      currentWs.onerror = () => {
        // onclose が続いて呼ばれるので再接続はそちらで処理
      }
    }

    connect()

    term.onData((data) => { sendWs({ type: 'input', data }) })

    let lastCols = 0, lastRows = 0
    function fitAndResize() {
      fitAddon.fit()
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols; lastRows = term.rows
        sendWs({ type: 'resize', cols: term.cols, rows: term.rows })
      }
    }

    // visualViewport はキーボード出現時も実際の可視高さを返す（100vh はキーボードを考慮しない）。
    // 両イベントが同時に発火して二重リサイズになるのを防ぐため、
    // visualViewport が使える環境では window.resize 側をスキップする。
    if (window.visualViewport) {
      const terminalEl = document.getElementById('terminal')
      window.visualViewport.addEventListener('resize', () => {
        terminalEl.style.height = window.visualViewport.height + 'px'
        fitAndResize()
      })
    }
    window.addEventListener('resize', () => {
      if (window.visualViewport) return
      fitAndResize()
    })

    // クライアント側keepalive
    keepaliveIntervalId = setInterval(() => {
      sendWs({ type: 'ping' })
    }, 30000)

    // ─── React Native から呼び出すブリッジ関数 ────────────────────────────

    /** セッション一覧をサーバーに要求する */
    window.requestSessionList = function() {
      sendWs({ type: 'session_list_request' })
    }

    /** 既存セッションに切り替える */
    window.switchToSession = function(sessionId) {
      sendWs({ type: 'session_attach', sessionId })
    }

    /** 新規セッションを作成して切り替える（常に claude セッションとして起動） */
    window.createNewSession = function(newProjectPath) {
      const source = newProjectPath
        ? { kind: 'claude', projectPath: newProjectPath }
        : { kind: 'claude' }
      sendWs({ type: 'session_create', source })
    }

    /** 承認ダイアログの結果をサーバーへ送信する */
    window.sendPermissionResponse = function(requestId, decision) {
      sendWs({ type: 'permission_response', requestId, decision })
    }

    /** React Native のカスタムキーボードから直接キー入力を注入する */
    window.sendInput = function(data) {
      sendWs({ type: 'input', data })
    }
  </script>
</body>
</html>
`
}
