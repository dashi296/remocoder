import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { TerminalPanel } from '../components/TerminalPanel'

// xterm と FitAddon をモック
const mockTermDispose = vi.fn()
const mockTermWrite = vi.fn()
const mockTermOnData = vi.fn()
const mockTermOpen = vi.fn()
const mockTermLoadAddon = vi.fn()
const mockFitAddonFit = vi.fn()
let mockOnDataCb: ((data: string) => void) | null = null

vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: mockTermLoadAddon,
    open: mockTermOpen,
    write: mockTermWrite,
    onData: vi.fn((cb: (data: string) => void) => {
      mockOnDataCb = cb
      return { dispose: vi.fn() }
    }),
    dispose: mockTermDispose,
    cols: 80,
    rows: 30,
  })),
}))

vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: mockFitAddonFit,
    dispose: vi.fn(),
  })),
}))

vi.mock('xterm/css/xterm.css', () => ({}))

// ResizeObserver をモック
let mockResizeObserverObserveCb: (() => void) | null = null
const mockResizeObserverDisconnect = vi.fn()
const mockResizeObserverObserve = vi.fn()

// electronAPI モック
const mockPtyInput = vi.fn()
const mockPtyResize = vi.fn()
const mockCloseTerminalWindow = vi.fn().mockResolvedValue(undefined)
const mockPtyGetScrollback = vi.fn().mockResolvedValue(null)
let mockOutputCb: ((sid: string, data: string) => void) | null = null
let mockExitCb: ((sid: string, exitCode: number) => void) | null = null
const mockUnsubOutput = vi.fn()
const mockUnsubExit = vi.fn()
const mockOnPtyOutput = vi.fn((cb: (sid: string, data: string) => void) => {
  mockOutputCb = cb
  return mockUnsubOutput
})
const mockOnPtyExit = vi.fn((cb: (sid: string, exitCode: number) => void) => {
  mockExitCb = cb
  return mockUnsubExit
})

const mockElectronAPI = {
  ptyInput: mockPtyInput,
  ptyResize: mockPtyResize,
  closeTerminalWindow: mockCloseTerminalWindow,
  ptyGetScrollback: mockPtyGetScrollback,
  onPtyOutput: mockOnPtyOutput,
  onPtyExit: mockOnPtyExit,
}

describe('TerminalPanel', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnDataCb = null
    mockOutputCb = null
    mockExitCb = null
    // ResizeObserver グローバルモック
    ;(globalThis as any).ResizeObserver = vi.fn((cb: () => void) => ({
      observe: mockResizeObserverObserve,
      disconnect: mockResizeObserverDisconnect,
    }))
    // window.electronAPI セット
    ;(window as any).electronAPI = mockElectronAPI
    // mockPtyGetScrollback をデフォルト null に
    mockPtyGetScrollback.mockResolvedValue(null)
  })

  afterEach(() => {
    delete (globalThis as any).ResizeObserver
    delete (window as any).electronAPI
  })

  it('ヘッダーに「TERMINAL」ラベルを表示する', () => {
    render(<TerminalPanel sessionId="session-abc123" onClose={onClose} />)
    expect(screen.getByText('TERMINAL')).toBeInTheDocument()
  })

  it('セッション ID の先頭 8 文字をバッジに表示する', () => {
    render(<TerminalPanel sessionId="session-abc123" onClose={onClose} />)
    expect(screen.getByText('session-')).toBeInTheDocument()
  })

  it('閉じるボタンを表示する', () => {
    render(<TerminalPanel sessionId="session-abc123" onClose={onClose} />)
    expect(screen.getByTitle('Close terminal')).toBeInTheDocument()
  })

  it('閉じるボタンを押すと closeTerminalWindow が呼ばれ onClose が実行される', async () => {
    render(<TerminalPanel sessionId="session-abc123" onClose={onClose} />)
    fireEvent.click(screen.getByTitle('Close terminal'))
    await waitFor(() => {
      expect(mockCloseTerminalWindow).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('マウント時に ptyGetScrollback を sessionId で呼ぶ', () => {
    render(<TerminalPanel sessionId="test-session-id" onClose={onClose} />)
    expect(mockPtyGetScrollback).toHaveBeenCalledWith('test-session-id')
  })

  it('スクロールバックがあるとき term.write に書き込む', async () => {
    mockPtyGetScrollback.mockResolvedValue('scrollback data')
    render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    await waitFor(() => {
      expect(mockTermWrite).toHaveBeenCalledWith('scrollback data')
    })
  })

  it('スクロールバックが null のとき term.write を呼ばない', async () => {
    mockPtyGetScrollback.mockResolvedValue(null)
    render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    // Promiseが解決するのを待つ
    await act(async () => { await Promise.resolve() })
    expect(mockTermWrite).not.toHaveBeenCalled()
  })

  it('onPtyOutput で同じ sessionId の出力を term.write する', () => {
    render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => {
      mockOutputCb?.('my-session', 'hello output')
    })
    expect(mockTermWrite).toHaveBeenCalledWith('hello output')
  })

  it('onPtyOutput で別の sessionId の出力は term.write しない', () => {
    render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => {
      mockOutputCb?.('other-session', 'noise')
    })
    expect(mockTermWrite).not.toHaveBeenCalled()
  })

  it('onPtyExit で同じ sessionId のとき終了メッセージを term.write する', () => {
    render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => {
      mockExitCb?.('my-session', 0)
    })
    expect(mockTermWrite).toHaveBeenCalledWith(expect.stringContaining('Session exited'))
  })

  it('onPtyExit で別の sessionId のとき term.write しない', () => {
    render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => {
      mockExitCb?.('other-session', 0)
    })
    expect(mockTermWrite).not.toHaveBeenCalled()
  })

  it('キー入力 (onData) は ptyInput を呼ぶ', () => {
    render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => {
      mockOnDataCb?.('a')
    })
    expect(mockPtyInput).toHaveBeenCalledWith('my-session', 'a')
  })

  it('アンマウント時に term.dispose が呼ばれる', () => {
    const { unmount } = render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => { unmount() })
    expect(mockTermDispose).toHaveBeenCalledTimes(1)
  })

  it('アンマウント時に ResizeObserver が disconnect される', () => {
    const { unmount } = render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => { unmount() })
    expect(mockResizeObserverDisconnect).toHaveBeenCalledTimes(1)
  })

  it('アンマウント時に onPtyOutput のアンサブスクライブが呼ばれる', () => {
    const { unmount } = render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => { unmount() })
    expect(mockUnsubOutput).toHaveBeenCalledTimes(1)
  })

  it('アンマウント時に onPtyExit のアンサブスクライブが呼ばれる', () => {
    const { unmount } = render(<TerminalPanel sessionId="my-session" onClose={onClose} />)
    act(() => { unmount() })
    expect(mockUnsubExit).toHaveBeenCalledTimes(1)
  })
})
