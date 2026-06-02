import React, { useState } from 'react'
import type { SessionInfo, SessionSource, MultiplexerSessionInfo } from '@remocoder/shared'

interface SessionListProps {
  sessions: SessionInfo[]
  multiplexerSessions?: MultiplexerSessionInfo[]
  onOpenTerminal?: (sessionId: string) => void
  onNewSession?: () => void
  onAttachMultiplexer?: (tool: MultiplexerSessionInfo['tool'], sessionName: string) => void
  onRefreshMultiplexer?: () => void
}

// ── ヘルパー関数 ──────────────────────────────────────────────────────────────

function sourceIcon(source?: SessionSource): string {
  if (!source) return '🖥'
  switch (source.kind) {
    case 'claude': return '🤖'
    case 'shell':  return '🐚'
    case 'tmux':   return '📟'
    case 'screen': return '🖥'
    case 'zellij': return '🪟'
    default:       return '🖥'
  }
}

function resolveProjectName(session: SessionInfo): string | undefined {
  const path =
    (session.source?.kind === 'claude' ? session.source.projectPath : undefined) ??
    session.projectPath
  if (!path) return undefined
  return path.split('/').filter(Boolean).pop()
}

function formatElapsed(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h} hr ago`
}

function formatLastActive(isoString?: string): string | undefined {
  if (!isoString) return undefined
  const ms = Date.now() - new Date(isoString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 5) return 'active just now'
  if (s < 60) return `active ${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `active ${m} min ago`
  return undefined
}

function getLabelKey(sessionId: string): string {
  return `session-label-${sessionId}`
}

function loadLabel(sessionId: string): string {
  try {
    return localStorage.getItem(getLabelKey(sessionId)) ?? ''
  } catch {
    return ''
  }
}

function saveLabel(sessionId: string, label: string): void {
  try {
    if (label.trim()) {
      localStorage.setItem(getLabelKey(sessionId), label.trim())
    } else {
      localStorage.removeItem(getLabelKey(sessionId))
    }
  } catch {
    // localStorage 不使用環境（テスト等）では無視
  }
}

// ── SessionRow ───────────────────────────────────────────────────────────────

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
  const isThinking = session.claudePhase === 'thinking' || session.claudePhase === 'writing'

  const [isEditing, setIsEditing] = useState(false)
  const [labelValue, setLabelValue] = useState(() => loadLabel(session.id))

  const projectName = resolveProjectName(session)
  const displayName = labelValue || projectName || session.clientIP || `client_${session.id.slice(0, 6)}`

  const handleLabelBlur = () => {
    saveLabel(session.id, labelValue)
    setIsEditing(false)
  }

  const handleLabelKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      saveLabel(session.id, labelValue)
      setIsEditing(false)
    }
    if (e.key === 'Escape') {
      setLabelValue(loadLabel(session.id))
      setIsEditing(false)
    }
  }

  const phaseLabel = (() => {
    switch (session.claudePhase) {
      case 'thinking': return 'THINKING'
      case 'writing':  return 'WRITING'
      case 'waiting':  return 'WAITING'
      default:         return null
    }
  })()

  const phaseColor = (() => {
    switch (session.claudePhase) {
      case 'thinking': return 'var(--blue, #60a5fa)'
      case 'writing':  return 'var(--green)'
      case 'waiting':  return 'var(--amber)'
      default:         return undefined
    }
  })()

  const lastActiveText = formatLastActive(session.lastActiveAt)
  const metaParts = [
    session.isExternal ? 'EXTERNAL' : session.clientIP,
    formatElapsed(session.createdAt),
    lastActiveText,
  ].filter(Boolean)

  return (
    <div style={{ ...styles.card, animationDelay: `${index * 0.06}s` }}>
      {/* ヘッダー行 */}
      <div style={styles.cardHeader}>
        <div style={styles.cardLeft}>
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
          <span style={styles.icon}>{sourceIcon(session.source)}</span>
          {isEditing ? (
            <input
              style={styles.labelInput}
              value={labelValue}
              autoFocus
              onChange={(e) => setLabelValue(e.target.value)}
              onBlur={handleLabelBlur}
              onKeyDown={handleLabelKeyDown}
              placeholder={projectName ?? 'Session name'}
            />
          ) : (
            <span
              style={styles.labelText}
              title="Click to rename"
              onClick={() => setIsEditing(true)}
            >
              <span style={styles.labelName}>{displayName}</span>
              <span style={styles.editHint}>✎</span>
            </span>
          )}
        </div>
        <div style={styles.cardRight}>
          {phaseLabel && (
            <span style={{ ...styles.phaseBadge, color: phaseColor, borderColor: phaseColor }}>
              {phaseLabel}
            </span>
          )}
          <span
            style={{
              ...styles.statusBadge,
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

      {/* メタ情報行 */}
      {metaParts.length > 0 && (
        <div style={styles.cardMeta}>
          {metaParts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={styles.metaSep}>·</span>}
              <span style={styles.metaText}>{part}</span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* アクティビティバー */}
      {isThinking && <div style={styles.activityBar} />}

      {/* 最終出力プレビュー */}
      {session.lastOutputLine && (
        <div style={styles.outputPreview}>▸ {session.lastOutputLine}</div>
      )}
    </div>
  )
}

// ── MultiplexerRow ────────────────────────────────────────────────────────────

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
    <div style={{ ...styles.card, animationDelay: `${index * 0.06}s` }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardLeft}>
          <span style={{ ...styles.statusBadge, color: 'var(--amber)', borderColor: 'var(--amber-dim)', background: 'var(--amber-glow)' }}>
            {toolLabel(info.tool)}
          </span>
          <span style={styles.labelText}>{info.sessionName}</span>
        </div>
        <div style={styles.cardRight}>
          {onAttach && (
            <button style={styles.openButton} onClick={() => onAttach(info.tool, info.sessionName)} title="Attach">
              <AttachIcon />
            </button>
          )}
        </div>
      </div>
      {(info.detail || info.workingDirectory) && (
        <div style={styles.cardMeta}>
          {info.detail && <span style={styles.metaText}>{info.detail}</span>}
          {info.workingDirectory && (
            <>
              {info.detail && <span style={styles.metaSep}>·</span>}
              <span style={{ ...styles.metaText, fontFamily: 'monospace' }} title={info.workingDirectory}>
                {info.workingDirectory}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── SessionList ───────────────────────────────────────────────────────────────

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
            <div style={styles.emptyIcon}><WifiIcon /></div>
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

// ── アイコン ─────────────────────────────────────────────────────────────────

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
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 12.55a11 11 0 0114.08 0"/>
      <path d="M1.42 9a16 16 0 0121.16 0"/>
      <path d="M8.53 16.11a6 6 0 016.95 0"/>
      <circle cx="12" cy="20" r="1" fill="currentColor"/>
    </svg>
  )
}

// ── スタイル ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  section: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    animation: 'fade-in 0.4s ease forwards',
    animationDelay: '0.1s',
    opacity: 0,
  },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--text-muted)', whiteSpace: 'nowrap',
  },
  headerLine: { flex: 1, height: 1, background: 'var(--border)' },
  count: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--green)', whiteSpace: 'nowrap',
  },
  newButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 20, height: 20,
    background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)', color: 'var(--green)', cursor: 'pointer', padding: 0,
  },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 0', color: 'var(--text-muted)',
  },
  emptyIcon: { color: 'var(--text-dim)', marginBottom: 4 },
  emptyText: { fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', letterSpacing: '0.05em' },
  emptySubText: { fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.05em', textAlign: 'center' },
  newSessionBtn: {
    marginTop: 8, padding: '5px 12px',
    background: 'var(--bg-elevated)', border: '1px solid var(--green-dim)',
    borderRadius: 'var(--radius)', color: 'var(--green)', fontSize: 10, cursor: 'pointer', letterSpacing: '0.05em',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  card: {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', overflow: 'hidden',
    animation: 'slide-in 0.25s ease forwards', opacity: 0,
  },
  cardHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '7px 10px', gap: 6,
  },
  cardLeft: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 },
  cardRight: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 },
  dot: { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  icon: { fontSize: 12, flexShrink: 0 },
  labelText: {
    fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em',
    cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    display: 'flex', alignItems: 'center', gap: 3,
  },
  labelName: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  editHint: { fontSize: 8, color: 'var(--text-dim)', opacity: 0.6, flexShrink: 0 },
  labelInput: {
    fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em',
    background: 'var(--bg-base)', border: '1px solid var(--green-dim)',
    borderRadius: 2, padding: '1px 4px', outline: 'none', minWidth: 0, flex: 1,
  },
  cardMeta: {
    display: 'flex', alignItems: 'center', gap: 4,
    paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap',
  },
  metaText: { fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.03em' },
  metaSep: { fontSize: 8, color: 'var(--text-dim)' },
  statusBadge: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
    padding: '2px 6px', border: '1px solid', borderRadius: 2, whiteSpace: 'nowrap', flexShrink: 0,
  },
  phaseBadge: {
    fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
    padding: '2px 6px', border: '1px solid', borderRadius: 2, whiteSpace: 'nowrap', flexShrink: 0,
    background: 'transparent',
  },
  activityBar: {
    height: 2,
    background: 'linear-gradient(90deg, transparent, var(--green) 50%, transparent)',
    backgroundSize: '200% 100%',
    animation: 'activity-scan 1.5s linear infinite',
  },
  outputPreview: {
    padding: '4px 10px', fontSize: 8, color: 'var(--green)',
    background: 'var(--bg-base)', borderTop: '1px solid var(--border)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    letterSpacing: '0.03em', fontFamily: 'monospace',
  },
  openButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, background: 'var(--bg-base)',
    border: '1px solid var(--border-bright)', borderRadius: 'var(--radius)',
    color: 'var(--green)', cursor: 'pointer', padding: 0, flexShrink: 0,
  },
}
