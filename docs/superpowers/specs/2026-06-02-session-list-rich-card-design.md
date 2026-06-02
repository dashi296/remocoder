# Session List Rich Card Design

**Date:** 2026-06-02  
**Status:** Approved

## 概要

セッション一覧（Desktop: `SessionList`、Mobile: `SessionPickerScreen`）に「何をしているか」が一目でわかる情報を追加する。各セッションをリッチカード形式で表示し、プロジェクト名・種別アイコン・経過時間・最終出力プレビュー・Claudeフェーズ・アクティビティインジケーター・ユーザー定義ラベルを表示する。

---

## 要件

### 表示する情報

| 情報 | データソース | 備考 |
|------|-------------|------|
| プロジェクト名 | `SessionInfo.source.projectPath` または `SessionInfo.projectPath` | パス末尾のディレクトリ名のみ表示 |
| セッション種別アイコン | `SessionInfo.source.kind` | claude/shell/tmux/screen/zellij に対応する絵文字または SVG |
| 経過時間 | `SessionInfo.createdAt` から計算 | 「23 min ago」形式 |
| 最終アクティブ時刻 | `SessionInfo.lastActiveAt`（新規追加） | 「active 30s ago」形式 |
| 最終出力行プレビュー | `SessionInfo.lastOutputLine`（新規追加） | 先頭80文字、カード下部に表示 |
| Claudeフェーズ | `SessionInfo.claudePhase`（新規追加） | THINKING / WRITING / WAITING / IDLE |
| アクティビティインジケーター | `claudePhase` が thinking/writing の場合 | カードに流れるアニメーションバー |
| ユーザー定義ラベル | `localStorage`（Desktop）/ `AsyncStorage`（Mobile） | インライン編集、セッションIDをキーに保存 |

### ユーザー定義ラベルの動作

- カードのプロジェクト名部分をクリックすると `<input>` に切り替わりインライン編集
- Enter または blur で確定、保存先は `localStorage`（キー: `session-label-${sessionId}`）
- ラベルが未設定の場合はプロジェクト名（またはセッションID短縮形）を表示
- 編集モード時は鉛筆アイコンをクリッカブルヒントとして表示

---

## アーキテクチャ

### データ層の変更

**`packages/shared/src/types.ts`**

`SessionInfo` に以下を追加：

```typescript
lastActiveAt?: string        // PTYへの最終出力時刻 (ISO 8601)
lastOutputLine?: string      // PTYの最終出力行（ANSI除去済み、最大80文字）
claudePhase?: 'thinking' | 'writing' | 'waiting' | 'idle'
```

### サーバー層の変更

**`packages/desktop/src/main/pty-server.ts`**

PTY出力 (`shell.onData`) のたびに以下を更新：

- `lastActiveAt`: `new Date().toISOString()`
- `lastOutputLine`: ANSI エスケープを除去した最終行（空行はスキップ）
- `claudePhase`: 下記パターンマッチで推定

**Claudeフェーズ判定ロジック（優先順）：**

1. `thinking`: 行にブレイルスピナー文字（`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`）が含まれる
2. `writing`: 行に `Writing` / `Reading` / `Editing` / `Bash` / `Tool` が含まれる  
3. `waiting`: 行末が `?` で終わる、または `Enter` / `press` / `confirm` が含まれる
4. 出力から30秒以上経過した場合 → `idle`（タイムアウトで更新）
5. それ以外 → `idle`

ANSI除去には軽量な正規表現を使用：`/\x1b\[[0-9;]*m/g`

`session_list` / `session_list_response` メッセージで送信する `SessionInfo` に上記フィールドを含める。

### UI層の変更

**`packages/desktop/src/renderer/components/SessionList.tsx`**

`SessionRow` を Rich Card 形式に置き換える。カード構造：

```
┌─────────────────────────────────────────────┐
│ [dot] [icon] [label/project]   [phase] [btn]│
│       [ip] · [elapsed] · [lastActive]       │
│▓▓▓▓▓▓░░░░░░░░░░░░  ← アクティビティバー     │
│ ▸ Analyzing packages/mobile/src/...         │
└─────────────────────────────────────────────┘
```

- アクティビティバー: `claudePhase` が `thinking` または `writing` の場合のみ表示（CSS animation）
- フェーズバッジ: `THINKING` は青、`WRITING` は緑、`WAITING` は黄、`IDLE` は非表示
- 最終出力プレビュー: カード下部、monospace、緑系の薄い文字色

**ユーザー定義ラベルのインライン編集：**

```
通常時: [icon] remocoder ✎（hover時に表示）
編集時: [icon] [______remocoder______]（input focus）
```

`SessionRow` に `editingLabel` / `labelValue` の local state を追加。

**`packages/mobile/src/screens/SessionPickerScreen.tsx`（または相当ファイル）**

Desktop と同等の情報をモバイル用スタイルで表示。ユーザー定義ラベルは `AsyncStorage` を使用。実際のファイルパスは実装前に確認する。

---

## 実装しないこと（スコープ外）

- サーバー側での `claudePhase` の精度向上（機械学習・複雑なパーサー等）
- セッション間でのラベル同期（Desktop ↔ Mobile 間はスコープ外）
- ラベルの削除UI（空文字で上書きすれば実質削除）

---

## 受け入れ条件

- [ ] セッション一覧にプロジェクト名（またはユーザー定義ラベル）が表示される
- [ ] 種別アイコン（claude/shell/tmux/screen/zellij）が表示される
- [ ] 「N min ago」形式の経過時間が表示される
- [ ] `lastOutputLine` がカード下部にプレビュー表示される（未取得時は非表示）
- [ ] `claudePhase` に応じたバッジとアクティビティバーが表示される
- [ ] カードのラベル部分をクリックするとインライン編集できる
- [ ] 編集したラベルが再起動後も保持される
- [ ] 既存の「Open terminal」ボタンの動作が壊れない
