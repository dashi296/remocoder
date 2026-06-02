import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SessionInfo } from '@remocoder/shared'
import { SessionList } from '../components/SessionList'

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-001',
    createdAt: new Date(Date.now() - 23 * 60 * 1000).toISOString(), // 23分前
    status: 'active',
    hasClient: false,
    ...overrides,
  }
}

describe('SessionList', () => {
  describe('セッションが 0 件のとき', () => {
    it('接続待ち中メッセージを表示する', () => {
      render(<SessionList sessions={[]} />)
      expect(screen.getByText('Waiting for connections')).toBeInTheDocument()
    })

    it('カウントに — を表示する', () => {
      render(<SessionList sessions={[]} />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })
  })

  describe('セッションが複数あるとき', () => {
    const sessions = [
      makeSession({ id: 'sess-001', status: 'active', source: { kind: 'claude', projectPath: '/home/user/remocoder' } }),
      makeSession({ id: 'sess-002', status: 'idle',   source: { kind: 'shell' } }),
    ]

    it('件数を "N ACTIVE" 形式で表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('2 ACTIVE')).toBeInTheDocument()
    })

    it('active セッションに ACTIVE バッジを表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    })

    it('idle セッションに IDLE バッジを表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('IDLE')).toBeInTheDocument()
    })

    it('プロジェクト名を表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('remocoder')).toBeInTheDocument()
    })
  })

  describe('claudePhase 表示', () => {
    it('claudePhase が "thinking" のとき THINKING バッジを表示する', () => {
      render(<SessionList sessions={[makeSession({ claudePhase: 'thinking' })]} />)
      expect(screen.getByText('THINKING')).toBeInTheDocument()
    })

    it('claudePhase が "writing" のとき WRITING バッジを表示する', () => {
      render(<SessionList sessions={[makeSession({ claudePhase: 'writing' })]} />)
      expect(screen.getByText('WRITING')).toBeInTheDocument()
    })

    it('claudePhase が "idle" または未設定のときフェーズバッジを表示しない', () => {
      render(<SessionList sessions={[makeSession({ claudePhase: 'idle' })]} />)
      expect(screen.queryByText('THINKING')).not.toBeInTheDocument()
      expect(screen.queryByText('WRITING')).not.toBeInTheDocument()
      expect(screen.queryByText('WAITING')).not.toBeInTheDocument()
    })
  })

  describe('lastOutputLine 表示', () => {
    it('lastOutputLine があるとき出力プレビューを表示する', () => {
      render(<SessionList sessions={[makeSession({ lastOutputLine: 'Analyzing src/index.ts' })]} />)
      expect(screen.getByText('▸ Analyzing src/index.ts')).toBeInTheDocument()
    })

    it('lastOutputLine がないとき出力プレビューを表示しない', () => {
      render(<SessionList sessions={[makeSession({ lastOutputLine: undefined })]} />)
      expect(screen.queryByText(/▸/)).not.toBeInTheDocument()
    })
  })

  describe('elapsed time', () => {
    it('経過時間を表示する', () => {
      render(<SessionList sessions={[makeSession()]} />)
      expect(screen.getByText(/min ago/)).toBeInTheDocument()
    })
  })

  describe('セッションが 1 件のとき', () => {
    it('1 ACTIVE と表示する', () => {
      render(<SessionList sessions={[makeSession()]} />)
      expect(screen.getByText('1 ACTIVE')).toBeInTheDocument()
    })
  })
})
