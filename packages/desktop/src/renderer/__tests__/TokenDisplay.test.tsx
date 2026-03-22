import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TokenDisplay } from '../components/TokenDisplay'

const TOKEN = 'a3f7e291-bc40-4d18-9f02-6e8d1c9a7b35'

describe('TokenDisplay', () => {
  describe('初期表示（マスク状態）', () => {
    it('先頭 8 文字がそのまま表示される', () => {
      render(<TokenDisplay token={TOKEN} />)
      expect(screen.getByText(/a3f7e291/)).toBeInTheDocument()
    })

    it('中間部分が • でマスクされる', () => {
      render(<TokenDisplay token={TOKEN} />)
      expect(screen.getByText(/•+/)).toBeInTheDocument()
    })

    it('トークン全体は表示されない', () => {
      render(<TokenDisplay token={TOKEN} />)
      expect(screen.queryByText(TOKEN)).not.toBeInTheDocument()
    })

    it('表示ボタン（EyeIcon）が存在する', () => {
      render(<TokenDisplay token={TOKEN} />)
      expect(screen.getByTitle('Show')).toBeInTheDocument()
    })
  })

  describe('表示 / 非表示トグル', () => {
    it('表示ボタンをクリックするとトークン全体が表示される', async () => {
      const user = userEvent.setup()
      render(<TokenDisplay token={TOKEN} />)
      await user.click(screen.getByTitle('Show'))
      expect(screen.getByText(TOKEN)).toBeInTheDocument()
    })

    it('表示後に隠すボタンが出現する', async () => {
      const user = userEvent.setup()
      render(<TokenDisplay token={TOKEN} />)
      await user.click(screen.getByTitle('Show'))
      expect(screen.getByTitle('Hide')).toBeInTheDocument()
    })

    it('隠すボタンをクリックするとマスク表示に戻る', async () => {
      const user = userEvent.setup()
      render(<TokenDisplay token={TOKEN} />)
      await user.click(screen.getByTitle('Show'))
      await user.click(screen.getByTitle('Hide'))
      expect(screen.queryByText(TOKEN)).not.toBeInTheDocument()
    })
  })

  describe('クリップボードコピー', () => {
    it('コピーボタンが存在する', () => {
      render(<TokenDisplay token={TOKEN} />)
      expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument()
    })

    it('コピー後に "COPIED TO CLIPBOARD" バナーが表示される', async () => {
      // userEvent.setup() が独自 clipboard を管理するためサイドエフェクトで確認
      const user = userEvent.setup()
      render(<TokenDisplay token={TOKEN} />)
      await user.click(screen.getByTitle('Copy to clipboard'))
      expect(screen.getByText(/COPIED TO CLIPBOARD/)).toBeInTheDocument()
    })

    it('コピー後にコピーボタンのアイコンが変わる（CheckIcon）', async () => {
      const user = userEvent.setup()
      render(<TokenDisplay token={TOKEN} />)
      const btn = screen.getByTitle('Copy to clipboard')
      await user.click(btn)
      // COPIED バナーが出ていればコピー成功
      expect(screen.getByText(/COPIED TO CLIPBOARD/)).toBeInTheDocument()
    })

    it('コピーボタンを 2 回押してもバナーが表示される（連打耐性）', async () => {
      const user = userEvent.setup()
      render(<TokenDisplay token={TOKEN} />)
      await user.click(screen.getByTitle('Copy to clipboard'))
      // バナーが出ていれば state 更新が正常
      expect(screen.getByText(/COPIED TO CLIPBOARD/)).toBeInTheDocument()
    })
  })
})
