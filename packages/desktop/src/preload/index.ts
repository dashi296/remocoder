import { contextBridge, ipcRenderer } from 'electron'
import type { SessionInfo } from '@remocoder/shared'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── 既存API ──────────────────────────────────────────────────────────────
  getTailscaleIP: (): Promise<string | null> => ipcRenderer.invoke('get-tailscale-ip'),
  getToken: (): Promise<string> => ipcRenderer.invoke('get-token'),
  getSessions: (): Promise<SessionInfo[]> => ipcRenderer.invoke('get-sessions'),
  rotateToken: (): Promise<string> => ipcRenderer.invoke('rotate-token'),
  onSessionsUpdate: (cb: (sessions: SessionInfo[]) => void) => {
    ipcRenderer.on('sessions-update', (_event, sessions: SessionInfo[]) => cb(sessions))
  },
  onTokenRotated: (cb: (token: string) => void) => {
    ipcRenderer.on('token-rotated', (_event, token: string) => cb(token))
  },
  onTailscaleIPUpdated: (cb: (ip: string | null) => void) => {
    ipcRenderer.on('tailscale-ip-updated', (_event, ip: string | null) => cb(ip))
  },

  // ── デスクトップターミナルAPI ──────────────────────────────────────────────

  /** 新規PTYセッションを作成し、セッションIDを返す */
  ptyCreate: (): Promise<string> => ipcRenderer.invoke('pty-create'),

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

  /** ターミナルウィンドウが開かれたことを通知 */
  onTerminalOpened: (cb: (sessionId: string) => void) => {
    ipcRenderer.on('terminal-opened', (_event, sessionId: string) => cb(sessionId))
  },

  /** ターミナルウィンドウが閉じられたことを通知 */
  onTerminalClosed: (cb: () => void) => {
    ipcRenderer.on('terminal-closed', () => cb())
  },
})
