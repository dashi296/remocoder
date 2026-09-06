# Mobile Slash Command Sheet Design

**Date:** 2026-09-06
**Status:** Approved

## 概要

モバイルアプリのターミナル画面から、Claude Code のスラッシュコマンドを検索付きシートで選び、入力欄に挿入できるようにする。候補はデスクトップ側がファイル走査で列挙し、並び順はモバイルが記録した使用回数で決める。

---

## 要件

### スコープ

| 項目 | 決定 |
|------|------|
| 対象コマンド | Claude Code のスラッシュコマンドのみ（シェルコマンド・プロンプト文は対象外） |
| 候補の出どころ | デスクトップ側のファイル走査 |
| 使用回数 | シート経由で挿入した回数のみ。モバイルローカルに記録 |
| UI | ツールバーの `/` ボタンから開く検索付きシート |
| 選択時の動作 | 文字列を入力欄に挿入するのみ。Enter は送らない |
| Codex 対応 | スコープ外。ただし後から追加できる形にする |

### 入力ストリームからのコマンド認識を採用しない理由

当初の要望は「入力したコマンドを認識して自動でリストを作る」だったが、以下の理由でファイル走査に切り替えた。

- Claude Code の入力欄は Ink による独自描画で、Enter 時にどの行を読めば入力内容が取れるかが不確実
- 候補メニュー選択・Tab 補完・履歴呼び出しではキーストリームに最終形が現れない。`/co` + ↓ + Enter は `/co\x1b[B` としてしか観測できない
- 結果として、よく使うコマンドほど取り逃す（頻度集計が逆バイアスになる）

使用回数はシート経由の送信をモバイル自身が数えるため、入力認識なしで「よく使う順」が成立する。手打ち分は数えない。

---

## アーキテクチャ

### コマンド一覧の収集（Desktop）

新規モジュール `packages/desktop/src/main/slash-command-scanner.ts`。

現在の Claude Code では `/` で呼べるのはコマンドだけでなくスキルも含まれる。コマンドのみを走査すると、カスタムコマンドを持たない環境ではほぼ空のリストになるため、両方を対象とする。

#### 走査対象と呼び出し名

| 種別 | 走査先 | 呼び出し名 | 表示上の名前空間 |
|------|--------|-----------|-----------------|
| コマンド（ユーザー） | `~/.claude/commands/**/*.md` | `/<ファイル名>` | サブディレクトリ名（`user:<dir>`） |
| コマンド（プロジェクト） | `<projectPath>/.claude/commands/**/*.md` | `/<ファイル名>` | サブディレクトリ名（`project:<dir>`） |
| スキル（ユーザー） | `~/.claude/skills/*/SKILL.md` | `/<ディレクトリ名>` | なし |
| スキル（プロジェクト） | `<projectPath>/.claude/skills/*/SKILL.md` | `/<ディレクトリ名>` | なし |
| プラグイン | 後述の manifest 解決による | `/<plugin名>:<コマンド/スキル名>` | なし |
| 組み込み | 固定リスト | `/<名前>` | なし |

**サブディレクトリは呼び出し名に含めない。** `.claude/commands/ci/build.md` の呼び出し名は `/build` であり、`ci` は表示上の名前空間注記（`/build (project:ci)`）にすぎない。`/ci:build` は存在しない名前になる。

コマンドの名前はファイル名から決まる。frontmatter の `name` は使わない。

#### プラグインの解決

1. `~/.claude/plugins/installed_plugins.json` を読む。値は `{ scope, installPath, version, ... }` の**配列**で、同一プラグインに複数レコードがあり得る
2. `~/.claude/settings.json` の `enabledPlugins`（`"<plugin>@<marketplace>": boolean`）を参照し、**明示的に `true` のもののみ**を対象とする。プロジェクト側の設定（`.claude/settings.json`、`.claude/settings.local.json`）に同キーがあればそちらを優先する
3. 各 `installPath` の `.claude-plugin/plugin.json` を読み、`name` を呼び出し名前空間とする（marketplace の登録キーではない）
4. manifest の `commands` / `skills` にパス指定があればそれに従い、なければ `commands/` と `skills/` をデフォルトとする。プラグイン root の `SKILL.md` も対象に含める

`installed_plugins.json` に載っていても `enabledPlugins` で `true` になっていないプラグインは除外する。インストール済みと有効は別であり、無効化してもインストール一覧には残るため。

#### 除外規則

- SKILL.md の frontmatter に `user-invocable: false` があるものは除外する（実際に codex プラグインの3スキルが該当）
- 設定に `skillOverrides` があり、対象スキルが `off` になっているものは除外する

#### 説明文

frontmatter の `description` を使う（コマンド・スキル共通で存在を確認済み）。スキルの description は段落単位で長いため、デスクトップ側で 120 文字に切り詰めてから送る。

#### 名前の重複解決

同じ呼び出し名が複数のスコープから得られた場合、1件に正規化する。優先順位は project > user > plugin > builtin とする。

#### 走査の安全性と上限

このモジュールはモバイルから WebSocket 経由で起動できるため、以下を必須とする。

- `projectPath` は絶対パスかつ実在するディレクトリであることを検証する。相対パスや非ディレクトリは project スコープの走査自体を行わない
- **シンボリックリンクは追う。** `~/.claude/skills/*` は実際に `~/.agents/skills/*`（`~/.claude/` の外）へのリンクであり、追わないと機能しない。したがって「realpath がこのディレクトリ配下に収まること」を条件にはできない
- 代わりに、**リンクを解決する前のパス**が期待するルート（`~/.claude/commands`、`~/.claude/skills`、`<projectPath>/.claude/`、`~/.claude/plugins/`）配下にあることを検証する。`installPath` も同じ扱いで、`~/.claude/plugins/` 配下でない文字列は無視する（この環境の全 `installPath` は現状リンク経由ではないことを確認済み）
- 読み取り範囲は、リンクを追った先も含めて対象の `.md` / `SKILL.md` のみに限定する。これと下記の上限が、リンクを追うことによる読み取り面の広がりを抑える
- 上限: 走査の最大深度 3、最大ファイル数 500、1ファイルあたりの読み取りは先頭 8KB のみ、走査全体のタイムアウト 3 秒。リンクを追う以上、循環は起こり得るため、訪問済みディレクトリを realpath で記録して再訪しない
- frontmatter だけが必要なので、ファイル全体は読まない

上限に達した場合は、そこまでに収集した一覧を返し、`truncated` フラグを立てる。

#### キャッシュ

`getRecentProjects`（`pty-server.ts:76`）は単一の `{ value, expiry }` キャッシュだが、コマンド一覧は projectPath に依存するため、そのまま模倣すると別プロジェクトへ切り替えた直後に前のプロジェクトの一覧を返す。`projectPath ?? '<none>'` をキーとする Map を持ち、TTL は 30 秒とする。

#### 拡張性

セッション種別による分岐は関数1つの `switch (source.kind)` とする。`claude` 以外は空配列を返す。Codex 対応時は case を1つ増やす。インターフェースやレジストリは作らない。

#### 組み込みコマンドの固定リスト

初期リストは以下とする。

```
/clear /compact /resume /init /review /model /status /memory /permissions
/config /cost /agents /mcp /add-dir /help
```

実装時に Claude Code の `/help` 出力と突き合わせ、存在しないものを削り、日常的に使うものが漏れていれば足す。判断に迷う場合は `/help` の出力を正とする。

このリストは Claude Code のバージョンアップで古くなる。実装時にコードへその旨を明記する。

### 通信と型（Shared）

**`packages/shared/src/types.ts`**

```ts
export interface SlashCommandInfo {
  /** 呼び出し名（先頭の / は含まない）。例: "commit", "commit-commands:commit" */
  name: string
  /** frontmatter の description。デスクトップ側で 120 文字に切り詰め済み */
  description?: string
  /** 提供元 */
  scope: 'builtin' | 'user' | 'project' | 'plugin'
  /** 表示用の名前空間注記。例: "project:ci"。呼び出し名には含まれない */
  namespace?: string
  /** scope が 'plugin' のときの plugin.json の name */
  pluginName?: string
}
```

`WsMessage` への追加:

```ts
| { type: 'command_list_request' }
| { type: 'command_list'; sessionId: string | null; commands: SlashCommandInfo[]; truncated?: boolean; error?: string }
```

### 通信の仕様（Desktop）

- `command_list_request` は引数を取らない。サーバーは接続ごとに保持している `attachedSessionId` からセッションを引き、その `source` を使う
- 応答には `sessionId` を含める。モバイルは、返ってきた一覧が現在表示中のセッションのものかを検証できる
- 未アタッチの接続からの要求には `sessionId: null`、`commands: []`、`error: 'not_attached'` を返す
- 走査に失敗した場合は `commands: []` と `error` を返す。接続は切らない
- `source.kind` が `claude` でない場合、および `source` を持たない外部登録セッションの場合は `commands: []` を返す

**projectPath の意味を限定する。** `PtySession.source` はセッション作成時に保存されたあと更新されず、アタッチ後にサーバーが中継するのは `input` と `resize` のみ（`pty-server.ts:926`）。したがってここで使える projectPath は「セッション作成時のプロジェクトパス」であり、Claude Code 内で `/cd` した後の現在の cwd ではない。これは既知の制限として受け入れ、cwd 追跡は行わない。

`{ kind: 'claude' }` のようにパスを持たないセッションでは、project スコープを省いた一覧（user + plugin + builtin）を返す。

### モバイル

#### `packages/mobile/src/assets/terminalHtml.ts`

- `window.requestCommandList()` を追加し、`command_list_request` を送る
- `command_list` 受信時に `postToNative({ type: 'command_list', ... })` する
- `session_attached` の native 転送（現在 `:257`）に `source` を含める。WebView 内部では既に `:252` で `currentSource` を更新しており、転送に足すだけなので再接続・再アタッチのフローは変わらない

#### `packages/mobile/src/screens/TerminalScreen.tsx`

- `commands` / `currentSource` / `sheetVisible` を state で保持する
- `currentSource` の初期値は URL パラメータの `source`、以降は `session_attached` の `source` で更新する
- `session_attached` を受けるたびに `window.requestCommandList()` を呼ぶ。デスクトップ側に TTL キャッシュがあるため再接続時の再取得は軽い
- 選択時は `window.sendInput('/<name>')` を呼び、シートを閉じ、使用回数を +1 する

セッション切替は `SessionPickerScreen` から `/terminal` へ遷移する形で行われる。`SessionSwitcherModal` は定義されているがどこからも import されていないため、これに依存した設計にはしない。

#### `packages/mobile/src/components/SlashCommandSheet.tsx`（新規）

`SessionSwitcherModal` と同じパターン（`Modal` + `visible` prop + `onClose`）で作る。UI 文言は既存に合わせて英語。

```
┌───────────────────────────────────┐
│ Commands                       ✕ │
├───────────────────────────────────┤
│ 🔍 Search…                        │
├───────────────────────────────────┤
│ /commit              project  12 │
│   Create a git commit             │
│ /code-review         plugin    8 │
│   Code review a pull request      │
│ /clear               builtin   3 │
│ /security-review     plugin      │
└───────────────────────────────────┘
```

- 検索は `name` と `description` の部分一致
- 並び順は使用回数の降順 → 名前の昇順。未使用は回数を表示せず後方
- 件数が数十件になるため `FlatList` を使う
- 検索欄でソフトキーボードが出るため、既存の `useKeyboardHeight` フックで高さを調整する
- `truncated` が立っている場合は一覧末尾にその旨を表示する

#### `packages/mobile/src/components/KeyboardToolbar.tsx`

CTRL トグルの隣に `/` ボタンを追加する。`source?.kind === 'claude'` のときだけ表示する。props に `source` と `onOpenCommands` を追加する。

#### 使用回数の保存

AsyncStorage の単一キー `slashCommandUsage`、値は `{ [name]: number }`。キーは正規化後の呼び出し名なので、重複解決済みの名前と1対1で対応する。

デスクトップ側に置く案もあるが、この使用回数を発生させるのはモバイルのシートだけで、デスクトップ側に同じ UI がない以上、共有する相手がいない。

読み書きに失敗した場合は使用回数なしとして扱い、一覧は名前順で表示する。

---

## 実装しないこと（スコープ外）

- 手打ちコマンドの認識。将来やるなら、Enter 検知時に xterm バッファのカーソル行（描画済みテキスト）を読む方式で、補完・履歴・候補選択の結果を拾う。代替スクリーン中は除外する
- Claude Code 内で `/cd` した後の cwd 追跡
- Codex 対応。組み込みスラッシュコマンド（`/init` `/diff` `/model` `/approvals` `/status` `/mcp` `/new` `/compact` `/review` `/skills` `/plugin`）は codex-cli 0.153.4 のバイナリから確認済み。ただし Claude Code の `~/.claude/commands/*.md` に相当するユーザー定義コマンドの置き場が見つかっておらず（`~/.codex/` にあるのは `skills/` `plugins/` `agents/` `hooks/` `rules/` で `prompts/` は無い）、ファイル走査で拾えるかは未確認
- デスクトップ側の UI へのコマンドシート追加

---

## 実装前に検証する項目

1. **挿入文字列に末尾スペースを付けるか。** `/commit` だと Claude Code の候補メニューが開いた状態になり、そのまま Enter を押すとハイライトされている行が確定する。`/co` のような前置一致では意図しないコマンドが選ばれる可能性がある。`/commit ` だとメニューが閉じて引数入力状態になる可能性がある。ユーザーがそのまま Enter を押したときに期待どおりになる方を採用する
2. **複数文字の `input` メッセージがペースト扱いにならないか。** 短い文字列なら問題ないはずだが確認する
3. **名前の重複解決の優先順位。** 本仕様では project > user > plugin > builtin としたが、Claude Code の実際の優先順位と一致するか確認する
4. **`enabledPlugins` のスコープ優先順位。** 本仕様ではプロジェクト設定をユーザー設定より優先としたが、managed settings を含む実際の解決順序を確認する

---

## テスト

- `slash-command-scanner` の単体テスト。一時ディレクトリに commands / skills / plugin manifest を配置し、以下を検証する
  - 呼び出し名の生成（サブディレクトリが名前に含まれないこと、plugin の `name` が使われること）
  - `enabledPlugins` で `true` でないプラグインが除外されること
  - `user-invocable: false` のスキルが除外されること
  - manifest の `skills` / `commands` パス指定が反映されること
  - frontmatter の欠落・不正 YAML でクラッシュしないこと
  - description の 120 文字切り詰めの境界
  - 深度・件数・サイズ・タイムアウトの各上限で `truncated` が立つこと
  - `installPath` が `~/.claude/plugins/` 外を指す場合に無視されること
  - `projectPath` が相対パス・非ディレクトリの場合に project スコープが走査されないこと
  - キャッシュが projectPath ごとに分かれていること
- `pty-server` の `command_list_request` ハンドラのテスト。未アタッチ、非 claude セッション、パスなしセッション、走査失敗の各応答を検証する（既存 `__tests__/pty-server.test.ts` に追加）
- `terminalHtml` のメッセージハンドラテスト。`command_list` の転送と `session_attached` への `source` 追加を検証する（既存 `__tests__/terminal.html.test.ts` に追加）
- `SlashCommandSheet` のレンダリング・検索フィルタ・並び順・AsyncStorage 失敗時のフォールバックのテスト

---

## 実装順序

1. `packages/shared` の型追加
2. `slash-command-scanner` + 単体テスト
3. `pty-server` のハンドラ + テスト
4. `terminalHtml` のブリッジ関数と `source` 転送修正 + テスト
5. `SlashCommandSheet` + テスト
6. `KeyboardToolbar` / `TerminalScreen` の結線
7. 実機確認（「実装前に検証する項目」の1と2）

---

## 受け入れ条件

- claude セッションのターミナル画面でツールバーに `/` ボタンが表示され、claude 以外のセッションでは表示されない
- `/` ボタンからシートが開き、ユーザー・プロジェクト・プラグイン・組み込みのコマンドとスキルが一覧される
- 無効なプラグインのコマンドと `user-invocable: false` のスキルが一覧に出ない
- 検索でコマンド名と説明文の両方に対して絞り込める
- コマンドを選ぶと入力欄に文字列が挿入され、シートが閉じる。Enter は送られない
- 一度使ったコマンドが次にシートを開いたとき上位に表示される
- 別のセッションを開いたとき、そのセッションのプロジェクトに応じた一覧が取得される（切替は `SessionPickerScreen` からの画面遷移なので、`TerminalScreen` は再マウントされる）
- 走査が失敗しても接続は切れず、空の一覧が表示される
