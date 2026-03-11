# Claude Code Remote - 設計ドキュメント

## プロジェクト概要

デスクトップPC上で動作するClaude Codeのセッションを、モバイルデバイスからTailscale VPN経由でリモート操作するアプリケーション。

- **Desktopアプリ**: Electron（macOS / Windows / Linux）
- **Mobileアプリ**: React Native（iOS / Android）
- **通信**: WebSocket over Tailscale VPN
- **ターミナルUI**: xterm.js（React Native側はWebView内で使用）

---

## リポジトリ構成

```
claude-code-remote/
├── package.json                  # monorepo root (Turborepo)
├── turbo.json
├── packages/
│   ├── shared/                   # 共通型定義・ユーティリティ
│   │   ├── package.json
│   │   └── src/
│   │       └── types.ts
│   ├── desktop/                  # Electronアプリ
│   │   ├── package.json
│   │   ├── electron.vite.config.ts
│   │   └── src/
│   │       ├── main/             # Electronメインプロセス
│   │       │   ├── index.ts
│   │       │   ├── pty-server.ts
│   │       │   └── tailscale.ts
│   │       └── renderer/         # ElectronレンダラープロセスのUI
│   │           ├── App.tsx
│   │           └── components/
│   │               ├── StatusPanel.tsx
│   │               └── SessionList.tsx
│   └── mobile/                   # React Nativeアプリ
│       ├── package.json
│       ├── app.json
│       └── src/
│           ├── screens/
│           │   ├── ConnectScreen.tsx
│           │   └── TerminalScreen.tsx
│           ├── hooks/
│           │   └── useWebSocket.ts
│           ├── assets/
│           │   └── terminal.html
│           └── App.tsx
```

---

## 共有パッケージ（packages/shared）

### types.ts

```typescript
// WebSocketメッセージの型定義
export type WsMessage =
  | { type: 'input'; data: string }
  | { type: 'output'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'auth'; token: string }
  | { type: 'auth_ok' }
  | { type: 'auth_error'; reason: string }

export interface SessionInfo {
  id: string
  createdAt: string
  status: 'active' | 'idle'
}

export const DEFAULT_WS_PORT = 8080
```

---

## Desktopアプリ（packages/desktop）

### 技術スタック

- Electron（electron-vite推奨）
- node-pty（PTY制御）
- ws（WebSocketサーバー）
- React（レンダラーUI）

### メインプロセス: pty-server.ts

```typescript
import * as pty from 'node-pty'
import { WebSocketServer, WebSocket } from 'ws'
import { WsMessage, DEFAULT_WS_PORT } from '@claude-code-remote/shared'
import { v4 as uuidv4 } from 'uuid'

const AUTH_TOKEN = process.env.REMOTE_TOKEN ?? uuidv4()

export function startPtyServer(port = DEFAULT_WS_PORT) {
  const wss = new WebSocketServer({ port })

  console.log(`PTY server started on port ${port}`)
  console.log(`Auth token: ${AUTH_TOKEN}`)

  wss.on('connection', (ws) => {
    let authenticated = false
    let shell: pty.IPty | null = null

    // 認証待ちタイムアウト（5秒）
    const authTimeout = setTimeout(() => {
      if (!authenticated) ws.close()
    }, 5000)

    ws.on('message', (raw) => {
      const msg: WsMessage = JSON.parse(raw.toString())

      // 認証処理
      if (!authenticated) {
        if (msg.type === 'auth' && msg.token === AUTH_TOKEN) {
          authenticated = true
          clearTimeout(authTimeout)
          shell = spawnClaude(ws)
          ws.send(JSON.stringify({ type: 'auth_ok' }))
        } else {
          ws.send(JSON.stringify({ type: 'auth_error', reason: 'invalid token' }))
          ws.close()
        }
        return
      }

      if (!shell) return

      if (msg.type === 'input') shell.write(msg.data)
      if (msg.type === 'resize') shell.resize(msg.cols, msg.rows)
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      shell?.kill()
    })
  })

  return { wss, token: AUTH_TOKEN }
}

function spawnClaude(ws: WebSocket): pty.IPty {
  const shell = pty.spawn('claude', [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    env: { ...process.env },
  })

  shell.onData((data) => {
    const msg: WsMessage = { type: 'output', data }
    ws.send(JSON.stringify(msg))
  })

  return shell
}
```

### メインプロセス: index.ts

```typescript
import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { startPtyServer } from './pty-server'
import { getTailscaleIP } from './tailscale'

app.whenReady().then(async () => {
  const { token } = startPtyServer()
  const tailscaleIp = await getTailscaleIP()

  // システムトレイに常駐
  const tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Claude Code Remote')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Tailscale IP: ${tailscaleIp ?? '未接続'}`, enabled: false },
    { label: `Token: ${token}`, enabled: false },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]))
})
```

### tailscale.ts

```typescript
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function getTailscaleIP(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('tailscale ip -4')
    return stdout.trim()
  } catch {
    return null
  }
}
```

### レンダラーUI

- **StatusPanel**: Tailscale接続状態・IPアドレス・WS起動状態を表示
- **SessionList**: 接続中のモバイルクライアント一覧を表示

---

## Mobileアプリ（packages/mobile）

### 技術スタック

- React Native（Expo推奨）
- react-native-webview（ターミナルUI）
- @react-native-async-storage/async-storage（接続情報の保存）

### 画面構成

#### ConnectScreen.tsx

接続先のTailscale IPとAuthトークンを入力して接続する画面。

```typescript
import React, { useState } from 'react'
import { View, TextInput, Button, Text, StyleSheet } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEFAULT_WS_PORT } from '@claude-code-remote/shared'

interface Props {
  onConnect: (ip: string, token: string) => void
}

export function ConnectScreen({ onConnect }: Props) {
  const [ip, setIp] = useState('')
  const [token, setToken] = useState('')

  const handleConnect = async () => {
    await AsyncStorage.setItem('lastIp', ip)
    await AsyncStorage.setItem('lastToken', token)
    onConnect(ip, token)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Tailscale IP</Text>
      <TextInput
        style={styles.input}
        value={ip}
        onChangeText={setIp}
        placeholder="100.x.x.x"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
      />
      <Text style={styles.label}>Auth Token</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        autoCapitalize="none"
        secureTextEntry
      />
      <Button title="接続" onPress={handleConnect} disabled={!ip || !token} />
    </View>
  )
}
```

#### TerminalScreen.tsx

WebView内でxterm.jsを使ったターミナルを表示する画面。

```typescript
import React, { useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import { DEFAULT_WS_PORT } from '@claude-code-remote/shared'
import { buildTerminalHtml } from '../assets/terminal.html'

interface Props {
  ip: string
  token: string
}

export function TerminalScreen({ ip, token }: Props) {
  const wsUrl = `ws://${ip}:${DEFAULT_WS_PORT}`

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: buildTerminalHtml(wsUrl, token) }}
        style={styles.webview}
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1e1e1e' },
  webview: { flex: 1 },
})
```

#### assets/terminal.html

WebView内で動作するxterm.js + WebSocketクライアント。

```typescript
export function buildTerminalHtml(wsUrl: string, token: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/xterm@5/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8/lib/xterm-addon-fit.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5/css/xterm.css"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e1e; overflow: hidden; }
    #terminal { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    const term = new Terminal({
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, monospace',
      cursorBlink: true,
    })
    const fitAddon = new FitAddon.FitAddon()
    term.loadAddon(fitAddon)
    term.open(document.getElementById('terminal'))
    fitAddon.fit()

    const ws = new WebSocket('${wsUrl}')

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: '${token}' }))
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'output') term.write(msg.data)
      if (msg.type === 'auth_error') term.write('\\r\\n認証エラー: ' + msg.reason)
    }

    ws.onclose = () => {
      term.write('\\r\\n[接続が切断されました]')
    }

    term.onData((data) => {
      ws.send(JSON.stringify({ type: 'input', data }))
    })

    // リサイズ対応
    window.addEventListener('resize', () => {
      fitAddon.fit()
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    })

    // キープアライブ
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  </script>
</body>
</html>
`
}
```

---

## セキュリティ設計

- **通信経路**: Tailscale VPN内のみで通信（WireGuard暗号化済み）
- **認証**: 接続時にUUIDトークンで認証（5秒タイムアウト）
- **ポート公開**: Tailscaleネットワーク内にのみ公開（インターネット非公開）

> Tailscaleのおかげでネットワーク層のセキュリティは確保されているが、同一Tailscaleネットワーク内の他デバイスからの不正接続を防ぐためトークン認証は必須。

---

## 実装の優先順位

1. `packages/shared` の型定義作成
2. `packages/desktop` の PTYサーバー実装・動作確認（ブラウザのWebSocketクライアントでテスト）
3. `packages/mobile` のConnectScreen実装
4. `packages/mobile` のTerminalScreen実装（WebView + xterm.js）
5. Electronのシステムトレイ・UI実装
6. Tailscale IP自動取得の実装
7. 接続情報のローカル保存（AsyncStorage）
8. エラーハンドリング・再接続ロジック

---

## 依存パッケージ

### desktop

```json
{
  "dependencies": {
    "node-pty": "^1.0.0",
    "ws": "^8.0.0",
    "uuid": "^9.0.0",
    "electron": "^30.0.0"
  },
  "devDependencies": {
    "electron-vite": "^2.0.0",
    "@types/ws": "^8.0.0",
    "@types/uuid": "^9.0.0"
  }
}
```

### mobile

```json
{
  "dependencies": {
    "react-native": "0.74.x",
    "expo": "~51.0.0",
    "react-native-webview": "^13.0.0",
    "@react-native-async-storage/async-storage": "^1.23.0"
  }
}
```

---

## 既知の制約・注意点

- React NativeのネイティブターミナルコンポーネントはOSSで成熟したものがないためWebView + xterm.jsを採用
- node-ptyはネイティブモジュールのためElectronのrebuildが必要（`electron-rebuild`）
- iOS実機でのWebSocket接続にはATS（App Transport Security）の設定が必要な場合あり（Tailscale IPはプライベートIPのため通常は不要）
- xterm.jsのFitAddonはWebViewのリサイズイベントで`fitAddon.fit()`を呼ぶ必要あり
