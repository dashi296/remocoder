import React from 'react'

interface StatusPanelProps {
  tailscaleIP: string | null
  wsPort: number
  wsRunning: boolean
}

const dot: React.CSSProperties = {
  display: 'inline-block',
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
}

export function StatusPanel({ tailscaleIP, wsPort, wsRunning }: StatusPanelProps) {
  const tailscaleConnected = tailscaleIP !== null

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionLabel}>SYS_STATUS</span>
        <div style={styles.headerLine} />
      </div>

      {/* Tailscale row */}
      <div style={styles.row}>
        <div style={styles.rowLeft}>
          <span
            style={{
              ...dot,
              backgroundColor: tailscaleConnected ? 'var(--green)' : 'var(--red)',
              boxShadow: tailscaleConnected
                ? '0 0 6px var(--green)'
                : '0 0 6px var(--red)',
              animation: tailscaleConnected ? 'pulse-green 2s ease-in-out infinite' : undefined,
            }}
          />
          <span style={styles.label}>TAILSCALE</span>
        </div>
        <div style={styles.rowRight}>
          {tailscaleConnected ? (
            <span style={{ ...styles.value, color: 'var(--green)' }}>{tailscaleIP}</span>
          ) : (
            <span style={{ ...styles.value, color: 'var(--red)' }}>DISCONNECTED</span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={styles.rowDivider} />

      {/* WebSocket row */}
      <div style={styles.row}>
        <div style={styles.rowLeft}>
          <span
            style={{
              ...dot,
              backgroundColor: wsRunning ? 'var(--green)' : 'var(--amber)',
              boxShadow: wsRunning ? '0 0 6px var(--green)' : '0 0 4px var(--amber)',
              animation: wsRunning
                ? 'pulse-green 2s ease-in-out infinite'
                : 'pulse-amber 1.2s ease-in-out infinite',
            }}
          />
          <span style={styles.label}>WS_SERVER</span>
        </div>
        <div style={styles.rowRight}>
          {wsRunning ? (
            <span style={{ ...styles.value, color: 'var(--green)' }}>
              :{wsPort}
              <span style={styles.badge}>LIVE</span>
            </span>
          ) : (
            <span style={{ ...styles.value, color: 'var(--amber)' }}>STOPPED</span>
          )}
        </div>
      </div>

      {/* Connection string hint */}
      {tailscaleConnected && wsRunning && (
        <div style={styles.connectionHint}>
          <span style={styles.hintPrefix}>{'>'}</span>
          <span style={styles.hintText}>
            ws://{tailscaleIP}:{wsPort}
          </span>
        </div>
      )}
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    animation: 'fade-in 0.3s ease forwards',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
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
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 0',
  },
  rowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  rowRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.1em',
    color: 'var(--text-muted)',
  },
  value: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: 'var(--bg-base)',
    background: 'var(--green)',
    padding: '1px 4px',
    borderRadius: 2,
  },
  rowDivider: {
    height: 1,
    background: 'var(--border)',
    margin: '2px 0',
    opacity: 0.5,
  },
  connectionHint: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    padding: '6px 8px',
    background: 'var(--green-pulse)',
    border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)',
  },
  hintPrefix: {
    color: 'var(--green)',
    fontSize: 10,
    fontWeight: 700,
  },
  hintText: {
    color: 'var(--text-muted)',
    fontSize: 10,
    letterSpacing: '0.04em',
  },
}
