import React, { useState, useEffect } from 'react'
import QRCode from 'qrcode'

interface TokenDisplayProps {
  token: string
  tailscaleIP?: string | null
  serverName?: string
  onRotate?: () => Promise<void>
}

export function TokenDisplay({ token, tailscaleIP, serverName, onRotate }: TokenDisplayProps) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [rotating, setRotating] = useState(false)

  const handleRotate = async () => {
    if (!onRotate) return
    setRotating(true)
    setShowQr(false)
    try {
      await onRotate()
    } finally {
      setRotating(false)
    }
  }

  useEffect(() => {
    if (!showQr || !tailscaleIP) return
    const nameParam = serverName ? `&name=${encodeURIComponent(serverName)}` : ''
    const url = `remocoder://connect?ip=${tailscaleIP}&token=${token}${nameParam}`
    QRCode.toDataURL(url, {
      width: 180,
      margin: 2,
      color: { dark: '#d4d4d4', light: '#0d0d0d' },
    }).then(setQrDataUrl)
  }, [showQr, tailscaleIP, token, serverName])

  const masked = token.replace(/./g, (_, i) =>
    i < 8 ? token[i] : i < token.length - 4 ? '•' : token[i]
  )

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: do nothing silently
    }
  }

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={styles.sectionLabel}>AUTH_TOKEN</span>
        <div style={styles.headerLine} />
      </div>

      <div style={styles.tokenBox}>
        <span style={styles.tokenText}>
          {revealed ? token : masked}
        </span>

        <div style={styles.actions}>
          <button
            style={styles.iconBtn}
            onClick={() => setRevealed(r => !r)}
            title={revealed ? 'Hide' : 'Show'}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            style={{
              ...styles.iconBtn,
              ...(copied ? styles.iconBtnSuccess : {}),
            }}
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          {tailscaleIP && (
            <button
              style={{
                ...styles.iconBtn,
                ...(showQr ? styles.iconBtnActive : {}),
              }}
              onClick={() => setShowQr(v => !v)}
              title="Show QR code"
            >
              <QrIcon />
            </button>
          )}
          {onRotate && (
            <button
              style={{
                ...styles.iconBtn,
                ...(rotating ? styles.iconBtnSpinning : {}),
              }}
              onClick={handleRotate}
              disabled={rotating}
              title="Regenerate token"
            >
              <RotateIcon />
            </button>
          )}
        </div>
      </div>

      {copied && (
        <div style={styles.copiedBanner}>
          <span style={styles.copiedText}>{'>'} COPIED TO CLIPBOARD</span>
        </div>
      )}

      {showQr && tailscaleIP && (
        <div style={styles.qrContainer}>
          {qrDataUrl ? (
            <>
              <img src={qrDataUrl} alt="QR Code" style={styles.qrImage} />
              <span style={styles.qrHint}>Scan with mobile app</span>
            </>
          ) : (
            <span style={styles.qrHint}>Generating...</span>
          )}
        </div>
      )}
    </section>
  )
}

/* ── SVG Icons ────────────────────────────────── */

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function RotateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 4v6h-6"/>
      <path d="M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>
  )
}

function QrIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
      <path d="M14 14h.01M14 17h.01M17 14h.01M20 14h.01M17 17h3M20 20h.01M17 20h.01"/>
    </svg>
  )
}

/* ── Styles ───────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  section: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--border)',
    animation: 'fade-in 0.35s ease forwards',
    animationDelay: '0.05s',
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
  tokenBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 10px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
  },
  tokenText: {
    flex: 1,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.06em',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-mono)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  iconBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    background: 'transparent',
    border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    outline: 'none',
  },
  iconBtnSuccess: {
    borderColor: 'var(--green)',
    color: 'var(--green)',
    background: 'var(--green-pulse)',
  },
  iconBtnActive: {
    borderColor: 'var(--green)',
    color: 'var(--green)',
  },
  iconBtnSpinning: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  qrContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    padding: '12px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-bright)',
    borderRadius: 'var(--radius)',
    animation: 'fade-in 0.2s ease',
  },
  qrImage: {
    width: 180,
    height: 180,
    borderRadius: 4,
  },
  qrHint: {
    fontSize: 9,
    color: 'var(--text-muted)',
    letterSpacing: '0.08em',
  },
  copiedBanner: {
    marginTop: 6,
    padding: '4px 8px',
    background: 'var(--green-pulse)',
    borderRadius: 'var(--radius)',
    animation: 'fade-in 0.2s ease',
  },
  copiedText: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--green)',
  },
}
