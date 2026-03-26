import React, { useEffect, useState } from 'react'
import './index.css'
import { StatusPanel } from './components/StatusPanel'
import { TokenDisplay } from './components/TokenDisplay'
import { SessionList } from './components/SessionList'
import { TerminalPanel } from './components/TerminalPanel'
import { DEFAULT_WS_PORT, type SessionInfo, type MultiplexerSessionInfo, type SessionSource, type UpdateInfo, type PowerSettings } from '@remocoder/shared'

// ── Mock data for development ─────────────────────────────
const MOCK_MODE = !(window as any).electronAPI

const mockAPI = {
  getTailscaleIP: async (): Promise<string | null> => '100.88.44.12',
  getToken: async (): Promise<string> => 'a3f7e291-bc40-4d18-9f02-6e8d1c9a7b35',
  getSessions: async (): Promise<SessionInfo[]> => [
    {
      id: 'sess-001',
      createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
      status: 'active',
      clientIP: '100.88.44.55',
      hasClient: true,
    },
    {
      id: 'sess-002',
      createdAt: new Date(Date.now() - 1000 * 30).toISOString(),
      status: 'idle',
      hasClient: false,
    },
  ],
  onSessionsUpdate: (_cb: (sessions: SessionInfo[]) => void) => () => { /* mock no-op */ },
  getServerName: async () => 'My Mac',
  rotateToken: async () => 'new-token',
  ptyCreate: async (_source?: SessionSource) => 'mock-session-id',
  ptyGetScrollback: async (_sessionId: string) => null as string | null,
  ptyInput: (_sessionId: string, _data: string) => { /* mock no-op */ },
  ptyResize: (_sessionId: string, _cols: number, _rows: number) => { /* mock no-op */ },
  openTerminalWindow: async (_sessionId: string) => { /* mock no-op */ },
  closeTerminalWindow: async () => { /* mock no-op */ },
  onPtyOutput: (_cb: (sessionId: string, data: string) => void) => () => { /* mock no-op */ },
  onPtyExit: (_cb: (sessionId: string, exitCode: number) => void) => () => { /* mock no-op */ },
  onTerminalOpened: (_cb: (sessionId: string) => void) => () => { /* mock no-op */ },
  onTerminalClosed: (_cb: () => void) => () => { /* mock no-op */ },
  getMultiplexerSessions: async (): Promise<MultiplexerSessionInfo[]> => [
    { tool: 'tmux', sessionName: 'main', detail: '3 windows' },
    { tool: 'tmux', sessionName: 'work', detail: '1 windows' },
  ],
  checkForUpdate: async () => { /* mock no-op */ },
  downloadUpdate: async () => { /* mock no-op */ },
  installUpdate: async () => { /* mock no-op */ },
  onUpdateAvailable: (_cb: (info: UpdateInfo) => void) => () => { /* mock no-op */ },
  onUpdateDownloaded: (_cb: (info: UpdateInfo) => void) => () => { /* mock no-op */ },
  onUpdateError: (_cb: (error: { message: string }) => void) => () => { /* mock no-op */ },
  getPowerSettings: async (): Promise<PowerSettings> => ({ preventSleepOnAC: false, preventSleepOnBattery: false }),
  setPowerSetting: async (_key: keyof PowerSettings, _enabled: boolean) => { /* mock no-op */ },
  getPowerStatus: async () => ({ isOnAC: true, isBlockerActive: false }),
  onPowerStatusChanged: (_cb: (status: { isOnAC: boolean; isBlockerActive: boolean }) => void) => () => { /* mock no-op */ },
}

const api = MOCK_MODE ? mockAPI : (window as any).electronAPI

// ─────────────────────────────────────────────────────────

export default function App() {
  const [tailscaleIP, setTailscaleIP] = useState<string | null>(null)
  const [token, setToken] = useState<string>('')
  const [serverName, setServerName] = useState<string>('')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [activeTerminalSessionId, setActiveTerminalSessionId] = useState<string | null>(null)
  const [multiplexerSessions, setMultiplexerSessions] = useState<MultiplexerSessionInfo[]>([])
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState<UpdateInfo | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [powerSettings, setPowerSettings] = useState<PowerSettings>({ preventSleepOnAC: false, preventSleepOnBattery: false })
  const [isOnAC, setIsOnAC] = useState(true)
  const [isBlockerActive, setIsBlockerActive] = useState(false)

  function loadMultiplexerSessions() {
    api.getMultiplexerSessions?.().then(setMultiplexerSessions).catch(() => {})
  }

  function applyPowerStatus(s: { isOnAC: boolean; isBlockerActive: boolean }) {
    setIsOnAC(s.isOnAC)
    setIsBlockerActive(s.isBlockerActive)
  }

  useEffect(() => {
    api.getTailscaleIP().then(setTailscaleIP)
    api.getToken().then(setToken)
    api.getServerName().then(setServerName).catch(() => {})
    api.getSessions().then(setSessions)
    loadMultiplexerSessions()

    const cleanupSessions = api.onSessionsUpdate(setSessions)
    const cleanupToken = api.onTokenRotated?.((newToken: string) => setToken(newToken))
    const cleanupIp = api.onTailscaleIPUpdated?.((newIp: string | null) => setTailscaleIP(newIp))
    // ターミナルウィンドウの開閉通知（別のウィンドウから通知される場合を考慮）
    const cleanupOpened = api.onTerminalOpened?.((sessionId: string) => setActiveTerminalSessionId(sessionId))
    const cleanupClosed = api.onTerminalClosed?.(() => setActiveTerminalSessionId(null))
    const cleanupUpdateAvailable = api.onUpdateAvailable?.((info: UpdateInfo) => {
      setUpdateAvailable(info)
      setUpdateError(null)
    })
    const cleanupUpdateDownloaded = api.onUpdateDownloaded?.((info: UpdateInfo) => {
      setUpdateDownloaded(info)
    })
    const cleanupUpdateError = api.onUpdateError?.((error: { message: string }) => {
      console.error('[updater] update error:', error.message)
      setUpdateError(error.message)
    })

    api.getPowerSettings?.().then(setPowerSettings).catch(() => {})
    api.getPowerStatus?.().then(applyPowerStatus).catch(() => {})
    const cleanupPower = api.onPowerStatusChanged?.(applyPowerStatus)

    return () => {
      cleanupSessions?.()
      cleanupToken?.()
      cleanupIp?.()
      cleanupOpened?.()
      cleanupClosed?.()
      cleanupUpdateAvailable?.()
      cleanupUpdateDownloaded?.()
      cleanupUpdateError?.()
      cleanupPower?.()
    }
  }, [])

  async function openSession(sessionId: string) {
    try {
      await api.openTerminalWindow(sessionId)
      setActiveTerminalSessionId(sessionId)
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleNewSession() {
    await openSession(await api.ptyCreate())
  }

  async function handleAttachMultiplexer(tool: MultiplexerSessionInfo['tool'], sessionName: string) {
    await openSession(await api.ptyCreate({ kind: tool, sessionName } as SessionSource))
  }

  async function handleDownloadUpdate(): Promise<void> {
    try {
      await api.downloadUpdate?.()
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleInstallUpdate(): Promise<void> {
    try {
      await api.installUpdate?.()
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleCloseTerminal(): void {
    setActiveTerminalSessionId(null)
  }

  async function handleSetPowerSetting(key: keyof PowerSettings, enabled: boolean): Promise<void> {
    await api.setPowerSetting?.(key, enabled)
    setPowerSettings((prev) => ({ ...prev, [key]: enabled }))
  }

  // ターミナルモード: TerminalPanelをフルスクリーンで表示
  if (activeTerminalSessionId) {
    return (
      <TerminalPanel
        sessionId={activeTerminalSessionId}
        onClose={handleCloseTerminal}
      />
    )
  }

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logoArea}>
          <div style={styles.logoMark}>
            <TerminalIcon />
          </div>
          <div style={styles.titleGroup}>
            <h1 style={styles.appName}>REMOCODER</h1>
          </div>
        </div>
        <div style={styles.statusDot}>
          <span style={styles.onlineIndicator} />
          <span style={styles.onlineText}>ONLINE</span>
        </div>
      </header>

      {/* Body */}
      <main style={styles.main}>
        <StatusPanel
          tailscaleIP={tailscaleIP}
          wsPort={DEFAULT_WS_PORT}
          wsRunning={true}
          updateAvailable={updateAvailable}
          updateDownloaded={updateDownloaded}
          updateError={updateError}
          onDownloadUpdate={handleDownloadUpdate}
          onInstallUpdate={handleInstallUpdate}
          powerSettings={powerSettings}
          isOnAC={isOnAC}
          isBlockerActive={isBlockerActive}
          onSetPowerSetting={handleSetPowerSetting}
        />
        {token && (
          <TokenDisplay
            token={token}
            tailscaleIP={tailscaleIP}
            serverName={serverName}
            onRotate={api.rotateToken ? async () => setToken(await api.rotateToken()) : undefined}
          />
        )}
        <SessionList
          sessions={sessions}
          multiplexerSessions={multiplexerSessions}
          onOpenTerminal={openSession}
          onNewSession={handleNewSession}
          onAttachMultiplexer={handleAttachMultiplexer}
          onRefreshMultiplexer={loadMultiplexerSessions}
        />
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <span style={styles.footerText}>RemoCoderr</span>
        <span style={styles.footerDivider}>·</span>
        <span style={styles.footerText}>v{__APP_VERSION__}</span>
        <span style={styles.footerDivider}>·</span>
        <span style={styles.footerText}>ws://:{DEFAULT_WS_PORT}</span>
      </footer>
    </div>
  )
}

function TerminalIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    minHeight: '100vh',
    background: 'var(--bg-base)',
    backgroundImage: `
      linear-gradient(var(--border) 1px, transparent 1px),
      linear-gradient(90deg, var(--border) 1px, transparent 1px)
    `,
    backgroundSize: '24px 24px',
    backgroundPosition: '-1px -1px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid var(--border-bright)',
    background: 'var(--bg-surface)',
    position: 'relative',
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)',
    color: 'var(--green)',
    boxShadow: '0 0 8px var(--green-glow)',
  },
  titleGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  appName: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.18em',
    color: 'var(--text-primary)',
    lineHeight: 1.2,
  },
  statusDot: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  onlineIndicator: {
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: 'var(--green)',
    boxShadow: '0 0 6px var(--green)',
    animation: 'pulse-green 2s ease-in-out infinite',
  },
  onlineText: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--green)',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(9, 11, 10, 0.85)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-surface)',
  },
  footerText: {
    fontSize: 9,
    color: 'var(--text-dim)',
    letterSpacing: '0.06em',
  },
  footerDivider: {
    color: 'var(--border-bright)',
    fontSize: 9,
  },
}
