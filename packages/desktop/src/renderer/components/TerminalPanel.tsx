import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

interface Props {
  sessionId: string
  onClose: () => void
}

declare const window: Window & {
  electronAPI: {
    ptyGetScrollback: (sessionId: string) => Promise<string | null>
    ptyInput: (sessionId: string, data: string) => void
    ptyResize: (sessionId: string, cols: number, rows: number) => void
    onPtyOutput: (cb: (sessionId: string, data: string) => void) => () => void
    onPtyExit: (cb: (sessionId: string, exitCode: number) => void) => () => void
    closeTerminalWindow: () => Promise<void>
  }
}

export function TerminalPanel({ sessionId, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const handleClose = useCallback(async () => {
    await window.electronAPI.closeTerminalWindow()
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!containerRef.current) return
    let active = true

    // ターミナル初期化
    const term = new Terminal({
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term
    fitAddonRef.current = fitAddon

    // キー入力 → PTY
    const onDataDispose = term.onData((data) => {
      window.electronAPI.ptyInput(sessionId, data)
    })

    // PTY出力 → ターミナル
    const unsubOutput = window.electronAPI.onPtyOutput((sid, data) => {
      if (sid === sessionId) term.write(data)
    })

    // PTY終了
    const unsubExit = window.electronAPI.onPtyExit((sid, exitCode) => {
      if (sid === sessionId) {
        term.write(`\r\n\x1b[33m[セッションが終了しました (exit code: ${exitCode})]\x1b[0m\r\n`)
      }
    })

    // リサイズ対応
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      window.electronAPI.ptyResize(sessionId, term.cols, term.rows)
    })
    resizeObserver.observe(containerRef.current)

    // スクロールバック（過去の出力）を取得して表示
    window.electronAPI.ptyGetScrollback(sessionId).then((scrollback) => {
      if (!active) return
      if (scrollback) {
        term.write(scrollback)
      }
      // スクロールバック書き込み後にサイズ通知
      fitAddon.fit()
      window.electronAPI.ptyResize(sessionId, term.cols, term.rows)
    })

    return () => {
      active = false
      onDataDispose.dispose()
      unsubOutput()
      unsubExit()
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId])

  return (
    <div style={styles.container}>
      {/* ヘッダー */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <TerminalIcon />
          <span style={styles.headerTitle}>TERMINAL</span>
          <span style={styles.sessionBadge}>{sessionId.slice(0, 8)}</span>
        </div>
        <button style={styles.closeButton} onClick={handleClose} title="ターミナルを閉じる">
          ✕
        </button>
      </div>

      {/* ターミナル本体 */}
      <div ref={containerRef} style={styles.terminal} />
    </div>
  )
}

function TerminalIcon() {
  return (
    <svg
      width="13"
      height="13"
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
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100vh',
    background: '#0d1117',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: '#161b22',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#4ec9b0',
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.18em',
    color: '#4ec9b0',
  },
  sessionBadge: {
    fontSize: 9,
    fontFamily: 'Menlo, Monaco, monospace',
    color: 'rgba(201,209,217,0.4)',
    letterSpacing: '0.08em',
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(201,209,217,0.5)',
    cursor: 'pointer',
    fontSize: 12,
    padding: '2px 4px',
    borderRadius: 3,
    lineHeight: 1,
  },
  terminal: {
    flex: 1,
    overflow: 'hidden',
    padding: '4px',
  },
}
