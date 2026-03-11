import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusPanel } from '../components/StatusPanel'

describe('StatusPanel', () => {
  describe('Tailscale 接続済みのとき', () => {
    it('IP アドレスを表示する', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.getByText('100.88.44.12')).toBeInTheDocument()
    })

    it('DISCONNECTED を表示しない', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.queryByText('DISCONNECTED')).not.toBeInTheDocument()
    })
  })

  describe('WS サーバーも起動中のとき', () => {
    it('接続文字列ヒントを表示する', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.getByText(/ws:\/\/100\.88\.44\.12:8080/)).toBeInTheDocument()
    })

    it('LIVE バッジを表示する', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.getByText('LIVE')).toBeInTheDocument()
    })
  })

  describe('Tailscale 未接続のとき', () => {
    it('DISCONNECTED を表示する', () => {
      render(<StatusPanel tailscaleIP={null} wsPort={8080} wsRunning={true} />)
      expect(screen.getByText('DISCONNECTED')).toBeInTheDocument()
    })

    it('IP アドレスを表示しない', () => {
      render(<StatusPanel tailscaleIP={null} wsPort={8080} wsRunning={true} />)
      expect(screen.queryByText('100.88.44.12')).not.toBeInTheDocument()
    })

    it('接続文字列ヒントを表示しない（WS が動いていても）', () => {
      render(<StatusPanel tailscaleIP={null} wsPort={8080} wsRunning={true} />)
      expect(screen.queryByText(/ws:\/\//)).not.toBeInTheDocument()
    })
  })

  describe('WS サーバーが停止しているとき', () => {
    it('STOPPED を表示する', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={false} />)
      expect(screen.getByText('STOPPED')).toBeInTheDocument()
    })

    it('LIVE バッジを表示しない', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={false} />)
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
    })

    it('接続文字列ヒントを表示しない', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={false} />)
      expect(screen.queryByText(/ws:\/\//)).not.toBeInTheDocument()
    })
  })

  describe('ポート番号', () => {
    it('指定したポート番号を表示する', () => {
      render(<StatusPanel tailscaleIP="100.88.44.12" wsPort={9090} wsRunning={true} />)
      // ポートは WS行・接続ヒント両方に現れるため getAllByText で確認
      const matches = screen.getAllByText(/:9090/)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })
})
