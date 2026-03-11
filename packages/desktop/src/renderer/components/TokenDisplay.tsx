import React, { useState } from 'react'

interface TokenDisplayProps {
  token: string
}

export function TokenDisplay({ token }: TokenDisplayProps) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

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
            title={revealed ? '隠す' : '表示'}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            style={{
              ...styles.iconBtn,
              ...(copied ? styles.iconBtnSuccess : {}),
            }}
            onClick={handleCopy}
            title="クリップボードにコピー"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>

      {copied && (
        <div style={styles.copiedBanner}>
          <span style={styles.copiedText}>{'>'} COPIED TO CLIPBOARD</span>
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
