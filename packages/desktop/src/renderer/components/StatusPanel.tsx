import React from 'react'
import type { UpdateInfo, PowerSettings } from '@remocoder/shared'

interface Props {
  tailscaleIP: string | null
  wsPort: number
  wsRunning: boolean
  updateAvailable: UpdateInfo | null
  updateDownloaded: UpdateInfo | null
  updateError: string | null
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  powerSettings: PowerSettings
  isOnAC: boolean
  isBlockerActive: boolean
  onSetPowerSetting: (key: keyof PowerSettings, enabled: boolean) => void
}

interface SleepRowProps {
  label: string
  enabled: boolean
  active: boolean
  activeColor: string
  onToggle: () => void
}

const dot: React.CSSProperties = {
  display: 'inline-block',
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
}

function SleepRow({ label, enabled, active, activeColor, onToggle }: SleepRowProps): React.ReactElement {
  return (
    <div style={styles.row}>
      <div style={styles.rowLeft}>
        <span
          style={{
            ...dot,
            backgroundColor: active ? activeColor : 'var(--text-dim)',
            boxShadow: active ? `0 0 6px ${activeColor}` : 'none',
          }}
        />
        <span style={styles.label}>{label}</span>
      </div>
      <div style={styles.rowRight}>
        <button
          style={{
            ...styles.toggleButton,
            color: enabled ? 'var(--bg-base)' : 'var(--text-muted)',
            background: enabled ? activeColor : 'transparent',
            border: enabled ? `1px solid ${activeColor}` : '1px solid var(--border-bright)',
          }}
          onClick={onToggle}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}

export function StatusPanel({
  tailscaleIP,
  wsPort,
  wsRunning,
  updateAvailable,
  updateDownloaded,
  updateError,
  onDownloadUpdate,
  onInstallUpdate,
  powerSettings,
  isOnAC,
  isBlockerActive,
  onSetPowerSetting,
}: Props): React.ReactElement {
  const tailscaleConnected = tailscaleIP !== null
  const updateInfo = updateDownloaded ?? updateAvailable

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

      {/* Power management */}
      <div style={styles.rowDivider} />

      {/* POWER_SOURCE row */}
      <div style={styles.row}>
        <div style={styles.rowLeft}>
          <span
            style={{
              ...dot,
              backgroundColor: isOnAC ? 'var(--green)' : 'var(--amber)',
              boxShadow: isOnAC ? '0 0 6px var(--green)' : '0 0 6px var(--amber)',
            }}
          />
          <span style={styles.label}>POWER_SOURCE</span>
        </div>
        <div style={styles.rowRight}>
          <span style={{ ...styles.value, color: isOnAC ? 'var(--green)' : 'var(--amber)' }}>
            {isOnAC ? 'AC' : 'BATTERY'}
          </span>
        </div>
      </div>

      {/* SLEEP/AC row */}
      <SleepRow
        label="SLEEP / AC"
        enabled={powerSettings.preventSleepOnAC}
        active={isBlockerActive && isOnAC}
        activeColor="var(--green)"
        onToggle={() => onSetPowerSetting('preventSleepOnAC', !powerSettings.preventSleepOnAC)}
      />

      {/* SLEEP/BAT row */}
      <SleepRow
        label="SLEEP / BAT"
        enabled={powerSettings.preventSleepOnBattery}
        active={isBlockerActive && !isOnAC}
        activeColor="var(--amber)"
        onToggle={() => onSetPowerSetting('preventSleepOnBattery', !powerSettings.preventSleepOnBattery)}
      />

      {/* Update error */}
      {updateError && (
        <>
          <div style={styles.rowDivider} />
          <div style={styles.updateErrorBanner}>
            <span
              style={{
                ...dot,
                backgroundColor: 'var(--red)',
                boxShadow: '0 0 6px var(--red)',
                flexShrink: 0,
              }}
            />
            <span style={styles.updateErrorText}>UPDATE_ERR — {updateError}</span>
          </div>
        </>
      )}

      {/* Update notification */}
      {updateInfo && (
        <>
          <div style={styles.rowDivider} />
          <div style={styles.updateBanner}>
            <div style={styles.updateBannerLeft}>
              <span
                style={{
                  ...dot,
                  backgroundColor: 'var(--amber)',
                  boxShadow: '0 0 6px var(--amber)',
                  animation: 'pulse-amber 1.2s ease-in-out infinite',
                }}
              />
              <div style={styles.updateTextGroup}>
                <span style={styles.updateLabel}>
                  UPDATE {updateDownloaded ? 'READY' : 'AVAILABLE'}
                  <span style={styles.updateVersion}>
                    {' '}v{updateInfo.version}
                  </span>
                </span>
                {updateInfo.isMajor && (
                  <span style={styles.majorWarning}>
                    MAJOR — モバイルとの互換性を確認してください
                  </span>
                )}
              </div>
            </div>
            {updateDownloaded ? (
              <button style={styles.updateButton} onClick={onInstallUpdate}>
                再起動して適用
              </button>
            ) : updateInfo.isMajor ? (
              <button style={styles.updateButton} onClick={onDownloadUpdate}>
                ダウンロードして適用
              </button>
            ) : (
              <span style={{ ...styles.updateLabel, color: 'var(--text-dim)' }}>DL中...</span>
            )}
          </div>
        </>
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
  updateErrorBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 0 2px',
  },
  updateErrorText: {
    fontSize: 9,
    color: 'var(--red)',
    letterSpacing: '0.04em',
    lineHeight: 1.5,
    wordBreak: 'break-all' as const,
  },
  updateBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0 2px',
    gap: 8,
  },
  updateBannerLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  updateTextGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    minWidth: 0,
  },
  updateLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--amber)',
  },
  updateVersion: {
    color: 'var(--text-muted)',
    fontWeight: 400,
  },
  majorWarning: {
    fontSize: 9,
    color: 'var(--red)',
    letterSpacing: '0.04em',
  },
  updateButton: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: 'var(--bg-base)',
    background: 'var(--amber)',
    border: 'none',
    borderRadius: 'var(--radius)',
    padding: '4px 8px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  toggleButton: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.12em',
    borderRadius: 2,
    padding: '2px 6px',
    cursor: 'pointer',
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
