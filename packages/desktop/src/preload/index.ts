import { contextBridge, ipcRenderer } from 'electron'
import type { SessionInfo, SessionSource, MultiplexerSessionInfo, UpdateInfo, PowerSettings } from '@remocoder/shared'

/** IPC イベントを購読し、解除関数を返す共通ヘルパー */
function makeListener<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 既存API ──────────────────────────────────────────────────────────────
  getTailscaleIP: (): Promise<string | null> => ipcRenderer.invoke('get-tailscale-ip'),
  getToken: (): Promise<string> => ipcRenderer.invoke('get-token'),
  getServerName: (): Promise<string> => ipcRenderer.invoke('get-server-name'),
  getSessions: (): Promise<SessionInfo[]> => ipcRenderer.invoke('get-sessions'),
  rotateToken: (): Promise<string> => ipcRenderer.invoke('rotate-token'),
  onSessionsUpdate: (cb: (sessions: SessionInfo[]) => void): (() => void) =>
    makeListener('sessions-update', cb),
  onTokenRotated: (cb: (token: string) => void): (() => void) =>
    makeListener('token-rotated', cb),
  onTailscaleIPUpdated: (cb: (ip: string | null) => void): (() => void) =>
    makeListener('tailscale-ip-updated', cb),

  // ── デスクトップターミナルAPI ──────────────────────────────────────────────

  /** 新規PTYセッションを作成し、セッションIDを返す */
  ptyCreate: (source?: SessionSource): Promise<string> => ipcRenderer.invoke('pty-create', source),

  /** tmux / screen / zellij のセッション一覧を返す */
  getMultiplexerSessions: (): Promise<MultiplexerSessionInfo[]> =>
    ipcRenderer.invoke('get-multiplexer-sessions'),

  /** セッションのスクロールバック（過去の出力）を返す */
  ptyGetScrollback: (sessionId: string): Promise<string | null> =>
    ipcRenderer.invoke('pty-get-scrollback', sessionId),

  /** PTYへキー入力を送る */
  ptyInput: (sessionId: string, data: string): void =>
    ipcRenderer.send('pty-input', { sessionId, data }),

  /** PTYをリサイズする */
  ptyResize: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send('pty-resize', { sessionId, cols, rows }),

  /** ターミナルウィンドウを開く（ウィンドウ拡大） */
  openTerminalWindow: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('open-terminal-window', sessionId),

  /** ターミナルウィンドウを閉じる（ウィンドウ縮小） */
  closeTerminalWindow: (): Promise<void> => ipcRenderer.invoke('close-terminal-window'),

  /** PTY出力を購読する。戻り値はリスナー解除関数 */
  onPtyOutput: (cb: (sessionId: string, data: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { sessionId, data }: { sessionId: string; data: string },
    ) => cb(sessionId, data)
    ipcRenderer.on('pty-output', handler)
    return () => ipcRenderer.removeListener('pty-output', handler)
  },

  /** PTY終了を購読する。戻り値はリスナー解除関数 */
  onPtyExit: (cb: (sessionId: string, exitCode: number) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      { sessionId, exitCode }: { sessionId: string; exitCode: number },
    ) => cb(sessionId, exitCode)
    ipcRenderer.on('pty-exit', handler)
    return () => ipcRenderer.removeListener('pty-exit', handler)
  },

  /** ターミナルウィンドウが開かれたことを通知。戻り値はリスナー解除関数 */
  onTerminalOpened: (cb: (sessionId: string) => void): (() => void) =>
    makeListener('terminal-opened', cb),

  /** ターミナルウィンドウが閉じられたことを通知。戻り値はリスナー解除関数 */
  onTerminalClosed: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on('terminal-closed', handler)
    return () => ipcRenderer.removeListener('terminal-closed', handler)
  },

  // ── 自動アップデートAPI ──────────────────────────────────────────────────────

  /** 手動で更新チェックをトリガー */
  checkForUpdate: (): Promise<void> => ipcRenderer.invoke('updater-check'),

  /** メジャーアップデートのダウンロードを開始する */
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('updater-download'),

  /** ダウンロード済みアップデートを適用して再起動 */
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updater-install'),

  /** 更新が利用可能になったときに呼ばれる。戻り値はリスナー解除関数 */
  onUpdateAvailable: (cb: (info: UpdateInfo) => void): (() => void) =>
    makeListener('update-available', cb),

  /** 更新のダウンロードが完了したときに呼ばれる。戻り値はリスナー解除関数 */
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void): (() => void) =>
    makeListener('update-downloaded', cb),

  /** アップデートエラーが発生したときに呼ばれる。戻り値はリスナー解除関数 */
  onUpdateError: (cb: (error: { message: string }) => void): (() => void) =>
    makeListener('update-error', cb),

  // ── 電源管理API ────────────────────────────────────────────────────────────

  /** スリープ抑制設定を取得する */
  getPowerSettings: (): Promise<PowerSettings> =>
    ipcRenderer.invoke('get-power-settings'),

  /** スリープ抑制設定を変更する */
  setPowerSetting: (key: keyof PowerSettings, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('set-power-setting', { key, enabled }),

  /** 現在の電源状態を取得する */
  getPowerStatus: (): Promise<{ isOnAC: boolean; isBlockerActive: boolean }> =>
    ipcRenderer.invoke('get-power-status'),

  /** 電源状態が変化したときに呼ばれる。戻り値はリスナー解除関数 */
  onPowerStatusChanged: (
    cb: (status: { isOnAC: boolean; isBlockerActive: boolean }) => void,
  ): (() => void) => makeListener('power-status-changed', cb),
})
