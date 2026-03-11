import React, { useEffect, useState } from 'react'
import './index.css'
import { StatusPanel } from './components/StatusPanel'
import { TokenDisplay } from './components/TokenDisplay'
import { SessionList, SessionInfo } from './components/SessionList'

const DEFAULT_WS_PORT = 8080

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
    },
    {
      id: 'sess-002',
      createdAt: new Date(Date.now() - 1000 * 30).toISOString(),
      status: 'idle',
      clientIP: '100.88.44.77',
    },
  ],
  onSessionsUpdate: (cb: (sessions: SessionInfo[]) => void) => {
    // no-op in mock mode
  },
}

const api = MOCK_MODE ? mockAPI : (window as any).electronAPI

// ─────────────────────────────────────────────────────────

export default function App() {
  const [tailscaleIP, setTailscaleIP] = useState<string | null>(null)
  const [token, setToken] = useState<string>('')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [wsRunning] = useState(true)

  useEffect(() => {
    api.getTailscaleIP().then(setTailscaleIP)
    api.getToken().then(setToken)
    api.getSessions().then(setSessions)
    api.onSessionsUpdate(setSessions)
  }, [])

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logoArea}>
          <div style={styles.logoMark}>
            <TerminalIcon />
          </div>
          <div style={styles.titleGroup}>
            <h1 style={styles.appName}>CLAUDE CODE</h1>
            <span style={styles.appSub}>REMOTE</span>
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
          wsRunning={wsRunning}
        />
        {token && <TokenDisplay token={token} />}
        <SessionList sessions={sessions} />
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <span style={styles.footerText}>claude-code-remote</span>
        <span style={styles.footerDivider}>·</span>
        <span style={styles.footerText}>v0.1.0</span>
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
    // Subtle grid background
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
    // Bottom accent line
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
  appSub: {
    fontSize: 9,
    fontWeight: 500,
    letterSpacing: '0.35em',
    color: 'var(--green)',
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
