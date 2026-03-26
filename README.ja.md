# Remocoder

デスクトップPC上で動作するClaude Codeのセッションを、モバイルデバイスからTailscale VPN経由でリモート操作するアプリケーションです。

[English README](./README.md)

---

## 概要

RemoCoderはデスクトップのClaude CodeセッションにiPhone/Androidからアクセスできるツールです。通信はTailscale VPN（WireGuard）で暗号化され、UUIDトークン認証によって保護されます。

---

## アーキテクチャ

```
モバイルアプリ (React Native / Expo)
        │
        │  WebSocket over Tailscale VPN
        │
デスクトップアプリ (Electron)
        │
        │  node-pty
        │
   Claude Code プロセス
```

| コンポーネント | 技術 |
|--------------|------|
| デスクトップアプリ | Electron + node-pty + ws |
| モバイルアプリ | React Native (Expo) + WebView + xterm.js |
| ターミナルUI | xterm.js（WebView内） |
| 通信 | WebSocket over Tailscale VPN |
| 認証 | UUIDトークン |

---

## リポジトリ構成

```
remocoder/
├── packages/
│   ├── shared/     # 共通型定義
│   ├── desktop/    # Electronデスクトップアプリ
│   ├── mobile/     # React Nativeモバイルアプリ (Expo)
│   └── cli/        # 外部ターミナルのClaudeセッションを登録するCLIツール
```

---

## 事前準備

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v9+
- [Tailscale](https://tailscale.com/) — デスクトップとモバイルの両方にインストール・ログイン済みであること
- [Claude Code](https://claude.ai/code) — デスクトップにインストール済みであること

---

## セットアップ

### 依存パッケージのインストール

```bash
pnpm install
```

### デスクトップアプリ

```bash
# 開発
pnpm dev

# 配布用ビルド
pnpm --filter @remocoder/desktop dist:mac    # macOS
pnpm --filter @remocoder/desktop dist:win    # Windows
pnpm --filter @remocoder/desktop dist:linux  # Linux
```

アプリはシステムトレイに常駐し、TailscaleのIPアドレスとモバイルアプリに入力するトークンを表示します。

### モバイルアプリ

```bash
# Expo開発サーバー起動
pnpm mobile

# iOSで起動
pnpm mobile:ios

# Androidで起動
pnpm mobile:android
```

---

## 使い方

1. **デスクトップアプリを起動** するとシステムトレイに常駐します。
2. トレイメニューに表示された **Tailscale IP** と **Auth Token** を確認します。
3. **モバイルアプリを開き**、Connect画面にIPとトークンを入力します。
4. **接続** をタップすると、デスクトップのClaude Codeに接続されたターミナルが開きます。

---

## セキュリティ

- 通信はすべてTailscale VPN（WireGuard暗号化）内で行われます。
- 接続ごとにUUIDトークン認証が必要です（5秒タイムアウト）。
- WebSocketポートはTailscaleネットワーク内にのみ公開され、インターネットには公開されません。

---

## テスト

```bash
pnpm test
```

---

## 技術スタック

| レイヤー | パッケージ |
|---------|----------|
| デスクトップフレームワーク | Electron 30 |
| PTY | node-pty |
| WebSocketサーバー | ws |
| モバイルフレームワーク | React Native 0.83 + Expo 55 |
| ターミナルUI | xterm.js 5 + xterm-addon-fit |
| ナビゲーション | expo-router |
| ビルドシステム | Turborepo + pnpm workspaces |

---

## ライセンス

MIT
