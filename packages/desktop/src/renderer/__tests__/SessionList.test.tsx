import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionList, SessionInfo } from '../components/SessionList'

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-001',
    createdAt: '2026-03-12T10:00:00.000Z',
    status: 'active',
    ...overrides,
  }
}

describe('SessionList', () => {
  describe('セッションが 0 件のとき', () => {
    it('接続待ち中メッセージを表示する', () => {
      render(<SessionList sessions={[]} />)
      expect(screen.getByText('接続待ち中')).toBeInTheDocument()
    })

    it('カウントに — を表示する', () => {
      render(<SessionList sessions={[]} />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })

    it('セッション行を表示しない', () => {
      render(<SessionList sessions={[]} />)
      expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument()
    })
  })

  describe('セッションが複数あるとき', () => {
    const sessions = [
      makeSession({ id: 'sess-001', status: 'active', clientIP: '100.88.44.55' }),
      makeSession({ id: 'sess-002', status: 'idle',   clientIP: '100.88.44.77' }),
    ]

    it('すべてのクライアント IP を表示する', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.getByText('100.88.44.55')).toBeInTheDocument()
      expect(screen.getByText('100.88.44.77')).toBeInTheDocument()
    })

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

    it('接続待ちメッセージを表示しない', () => {
      render(<SessionList sessions={sessions} />)
      expect(screen.queryByText('接続待ち中')).not.toBeInTheDocument()
    })
  })

  describe('clientIP がないとき', () => {
    it('client_ + id 先頭 6 文字をフォールバックで表示する', () => {
      render(<SessionList sessions={[makeSession({ id: 'abcdef123', clientIP: undefined })]} />)
      expect(screen.getByText('client_abcdef')).toBeInTheDocument()
    })
  })

  describe('createdAt の時刻フォーマット', () => {
    it('HH:MM:SS 形式で時刻を表示する', () => {
      // UTC+0 で 10:00:00 → JST では環境依存のため正規表現で確認
      render(<SessionList sessions={[makeSession({ createdAt: '2026-03-12T01:23:45.000Z' })]} />)
      expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })
  })

  describe('セッションが 1 件のとき', () => {
    it('1 ACTIVE と表示する', () => {
      render(<SessionList sessions={[makeSession()]} />)
      expect(screen.getByText('1 ACTIVE')).toBeInTheDocument()
    })
  })
})
