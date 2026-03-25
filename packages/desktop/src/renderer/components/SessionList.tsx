import React from 'react'
import type { SessionInfo, MultiplexerSessionInfo } from '@remocoder/shared'

interface SessionListProps {
  sessions: SessionInfo[]
  multiplexerSessions?: MultiplexerSessionInfo[]
  onOpenTerminal?: (sessionId: string) => void
  onNewSession?: () => void
  onAttachMultiplexer?: (tool: MultiplexerSessionInfo['tool'], sessionName: string) => void
  onRefreshMultiplexer?: () => void
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function SessionRow({
  session,
  index,
  onOpen,
}: {
  session: SessionInfo
  index: number
  onOpen?: (id: string) => void
}) {
  const isActive = session.status === 'active'
  const hasClient = session.hasClient ?? false

  return (
    <div
      style={{
        ...styles.row,
        animationDelay: `${index * 0.06}s`,
      }}
    >
      {/* Status indicator */}
      <div style={styles.rowLeft}>
        <span
          style={{
            ...styles.dot,
            backgroundColor: isActive ? 'var(--green)' : 'var(--amber)',
            boxShadow: isActive ? '0 0 5px var(--green)' : '0 0 4px var(--amber)',
            animation: isActive
              ? 'pulse-green 2s ease-in-out infinite'
              : 'pulse-amber 1.8s ease-in-out infinite',
          }}
        />
        <div style={styles.sessionInfo}>
          <span style={styles.sessionId}>
            {session.clientIP ?? `client_${session.id.slice(0, 6)}`}
          </span>
          <span style={styles.sessionTime}>{formatTime(session.createdAt)}</span>
        </div>
      </div>

      {/* Right side: badge + open button */}
      <div style={styles.rowRight}>
        <span
          style={{
            ...styles.badge,
            color: isActive ? 'var(--green)' : 'var(--amber)',
            borderColor: isActive ? 'var(--green-dim)' : 'var(--amber-dim)',
            background: isActive ? 'var(--green-pulse)' : 'var(--amber-glow)',
          }}
        >
          {session.status.toUpperCase()}
          {hasClient ? ' · Connected' : ''}
        </span>
        {onOpen && (
          <button style={styles.openButton} onClick={() => onOpen(session.id)} title="Open terminal">
            <TerminalIcon />
          </button>
        )}
      </div>
    </div>
  )
}

function toolLabel(tool: MultiplexerSessionInfo['tool']): string {
  return tool.toUpperCase()
}

function MultiplexerRow({
  info,
  index,
  onAttach,
}: {
  info: MultiplexerSessionInfo
  index: number
  onAttach?: (tool: MultiplexerSessionInfo['tool'], sessionName: string) => void
}) {
  return (
    <div style={{ ...styles.row, animationDelay: `${index * 0.06}s` }}>
      <div style={styles.rowLeft}>
        <span
          style={{
            ...styles.badge,
            color: 'var(--amber)',
            borderColor: 'var(--amber-dim)',
            background: 'var(--amber-glow)',
          }}
        >
          {toolLabel(info.tool)}
        </span>
        <div style={styles.sessionInfo}>
          <span style={styles.sessionId}>{info.sessionName}</span>
          {info.detail && <span style={styles.sessionTime}>{info.detail}</span>}
          {info.workingDirectory && (
            <span style={styles.sessionPath} title={info.workingDirectory}>
              {info.workingDirectory}
            </span>
          )}
        </div>
      </div>
      <div style={styles.rowRight}>
        {onAttach && (
          <button
            style={styles.openButton}
            onClick={() => onAttach(info.tool, info.sessionName)}
            title="Attach to session"
          >
            <AttachIcon />
          </button>
        )}
      </div>
    </div>
  )
}

export function SessionList({
  sessions,
  multiplexerSessions,
  onOpenTerminal,
  onNewSession,
  onAttachMultiplexer,
  onRefreshMultiplexer,
}: SessionListProps) {
  const hasMux = multiplexerSessions && multiplexerSessions.length > 0

  return (
    <>
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionLabel}>CONNECTIONS</span>
          <div style={styles.headerLine} />
          <span style={styles.count}>
            {sessions.length > 0 ? `${sessions.length} ACTIVE` : '—'}
          </span>
          {onNewSession && (
            <button style={styles.newButton} onClick={onNewSession} title="Create new session">
              <PlusIcon />
            </button>
          )}
        </div>

        {sessions.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>
              <WifiIcon />
            </div>
            <p style={styles.emptyText}>Waiting for connections</p>
            <p style={styles.emptySubText}>
              <span style={{ color: 'var(--green)', animation: 'blink 1.2s step-end infinite' }}>▮</span>
              {' '}Waiting for connection from mobile app
            </p>
            {onNewSession && (
              <button style={styles.newSessionBtn} onClick={onNewSession}>
                + Create new session
              </button>
            )}
          </div>
        ) : (
          <div style={styles.list}>
            {sessions.map((s, i) => (
              <SessionRow key={s.id} session={s} index={i} onOpen={onOpenTerminal} />
            ))}
          </div>
        )}
      </section>

      {/* マルチプレクサセクション（tmux / screen / zellij） */}
      {multiplexerSessions !== undefined && (
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <span style={styles.sectionLabel}>MULTIPLEXERS</span>
            <div style={styles.headerLine} />
            <span style={{ ...styles.count, color: hasMux ? 'var(--amber)' : 'var(--text-dim)' }}>
              {hasMux ? `${multiplexerSessions.length} FOUND` : '—'}
            </span>
            {onRefreshMultiplexer && (
              <button style={styles.newButton} onClick={onRefreshMultiplexer} title="Refresh list">
                <RefreshIcon />
              </button>
            )}
          </div>

          {!hasMux ? (
            <div style={styles.empty}>
              <p style={styles.emptyText}>No sessions</p>
              <p style={styles.emptySubText}>No tmux / screen / zellij sessions found</p>
            </div>
          ) : (
            <div style={styles.list}>
              {multiplexerSessions.map((m, i) => (
                <MultiplexerRow
                  key={`${m.tool}:${m.sessionName}`}
                  info={m}
                  index={i}
                  onAttach={onAttachMultiplexer}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}

function TerminalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function AttachIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

function WifiIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M5 12.55a11 11 0 0114.08 0"/>
      <path d="M1.42 9a16 16 0 0121.16 0"/>
      <path d="M8.53 16.11a6 6 0 016.95 0"/>
      <circle cx="12" cy="20" r="1" fill="currentColor"/>
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    animation: 'fade-in 0.4s ease forwards',
    animationDelay: '0.1s',
    opacity: 0,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  },
  headerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
  },
  count: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--green)',
    whiteSpace: 'nowrap',
  },
  newButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)',
    color: 'var(--green)',
    cursor: 'pointer',
    padding: 0,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '16px 0',
    color: 'var(--text-muted)',
  },
  emptyIcon: {
    color: 'var(--text-dim)',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
  },
  emptySubText: {
    fontSize: 9,
    color: 'var(--text-dim)',
    letterSpacing: '0.05em',
    textAlign: 'center',
  },
  newSessionBtn: {
    marginTop: 8,
    padding: '5px 12px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--green-dim)',
    borderRadius: 'var(--radius)',
    color: 'var(--green)',
    fontSize: 10,
    cursor: 'pointer',
    letterSpacing: '0.05em',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 10px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    animation: 'slide-in 0.25s ease forwards',
    opacity: 0,
  },
  rowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flex: 1,
  },
  rowRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  dot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  sessionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minWidth: 0,
  },
  sessionId: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-primary)',
    letterSpacing: '0.05em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sessionTime: {
    fontSize: 9,
    color: 'var(--text-muted)',
    letterSpacing: '0.04em',
  },
  sessionPath: {
    fontSize: 9,
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badge: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.1em',
    padding: '2px 6px',
    border: '1px solid',
    borderRadius: 2,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  toolBadge: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.1em',
    padding: '2px 6px',
    border: '1px solid',
    borderRadius: 2,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  openButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    background: 'var(--bg-base)',
    border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)',
    color: 'var(--green)',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
}
