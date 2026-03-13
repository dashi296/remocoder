import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusPanel } from '../components/StatusPanel'

const makeDefaultProps = () => ({
  updateAvailable: null,
  updateDownloaded: null,
  updateError: null,
  onDownloadUpdate: vi.fn(),
  onInstallUpdate: vi.fn(),
})

describe('StatusPanel', () => {
  describe('Tailscale 接続済みのとき', () => {
    it('IP アドレスを表示する', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.getByText('100.88.44.12')).toBeInTheDocument()
    })

    it('DISCONNECTED を表示しない', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.queryByText('DISCONNECTED')).not.toBeInTheDocument()
    })
  })

  describe('WS サーバーも起動中のとき', () => {
    it('接続文字列ヒントを表示する', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.getByText(/ws:\/\/100\.88\.44\.12:8080/)).toBeInTheDocument()
    })

    it('LIVE バッジを表示する', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.getByText('LIVE')).toBeInTheDocument()
    })
  })

  describe('Tailscale 未接続のとき', () => {
    it('DISCONNECTED を表示する', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP={null} wsPort={8080} wsRunning={true} />)
      expect(screen.getByText('DISCONNECTED')).toBeInTheDocument()
    })

    it('IP アドレスを表示しない', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP={null} wsPort={8080} wsRunning={true} />)
      expect(screen.queryByText('100.88.44.12')).not.toBeInTheDocument()
    })

    it('接続文字列ヒントを表示しない（WS が動いていても）', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP={null} wsPort={8080} wsRunning={true} />)
      expect(screen.queryByText(/ws:\/\//)).not.toBeInTheDocument()
    })
  })

  describe('WS サーバーが停止しているとき', () => {
    it('STOPPED を表示する', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={false} />)
      expect(screen.getByText('STOPPED')).toBeInTheDocument()
    })

    it('LIVE バッジを表示しない', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={false} />)
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument()
    })

    it('接続文字列ヒントを表示しない', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={false} />)
      expect(screen.queryByText(/ws:\/\//)).not.toBeInTheDocument()
    })
  })

  describe('ポート番号', () => {
    it('指定したポート番号を表示する', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={9090} wsRunning={true} />)
      // ポートは WS行・接続ヒント両方に現れるため getAllByText で確認
      const matches = screen.getAllByText(/:9090/)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('アップデート通知', () => {
    it('Minor updateAvailable があるとき UPDATE AVAILABLE バナーと DL中... を表示する', () => {
      render(
        <StatusPanel
          {...makeDefaultProps()}
          tailscaleIP="100.88.44.12"
          wsPort={8080}
          wsRunning={true}
          updateAvailable={{ version: '1.2.0', isMajor: false }}
        />,
      )
      expect(screen.getByText(/UPDATE AVAILABLE/)).toBeInTheDocument()
      expect(screen.getByText(/v1\.2\.0/)).toBeInTheDocument()
      expect(screen.getByText('DL中...')).toBeInTheDocument()
    })

    it('Major updateAvailable があるとき「ダウンロードして適用」ボタンを表示する', () => {
      render(
        <StatusPanel
          {...makeDefaultProps()}
          tailscaleIP="100.88.44.12"
          wsPort={8080}
          wsRunning={true}
          updateAvailable={{ version: '2.0.0', isMajor: true }}
        />,
      )
      expect(screen.getByText(/UPDATE AVAILABLE/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ダウンロードして適用' })).toBeInTheDocument()
    })

    it('「ダウンロードして適用」ボタンをクリックすると onDownloadUpdate が呼ばれる', async () => {
      const onDownloadUpdate = vi.fn()
      render(
        <StatusPanel
          {...makeDefaultProps()}
          onDownloadUpdate={onDownloadUpdate}
          tailscaleIP="100.88.44.12"
          wsPort={8080}
          wsRunning={true}
          updateAvailable={{ version: '2.0.0', isMajor: true }}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: 'ダウンロードして適用' }))
      expect(onDownloadUpdate).toHaveBeenCalledTimes(1)
    })

    it('updateDownloaded があるとき UPDATE READY と再起動ボタンを表示する', () => {
      render(
        <StatusPanel
          {...makeDefaultProps()}
          tailscaleIP="100.88.44.12"
          wsPort={8080}
          wsRunning={true}
          updateAvailable={{ version: '1.2.0', isMajor: false }}
          updateDownloaded={{ version: '1.2.0', isMajor: false }}
        />,
      )
      expect(screen.getByText(/UPDATE READY/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '再起動して適用' })).toBeInTheDocument()
    })

    it('再起動ボタンをクリックすると onInstallUpdate が呼ばれる', async () => {
      const onInstallUpdate = vi.fn()
      render(
        <StatusPanel
          {...makeDefaultProps()}
          onInstallUpdate={onInstallUpdate}
          tailscaleIP="100.88.44.12"
          wsPort={8080}
          wsRunning={true}
          updateAvailable={{ version: '1.2.0', isMajor: false }}
          updateDownloaded={{ version: '1.2.0', isMajor: false }}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: '再起動して適用' }))
      expect(onInstallUpdate).toHaveBeenCalledTimes(1)
    })

    it('isMajor のとき互換性警告を表示する', () => {
      render(
        <StatusPanel
          {...makeDefaultProps()}
          tailscaleIP="100.88.44.12"
          wsPort={8080}
          wsRunning={true}
          updateAvailable={{ version: '2.0.0', isMajor: true }}
        />,
      )
      expect(screen.getByText(/MAJOR/)).toBeInTheDocument()
    })

    it('更新なしのとき更新バナーを表示しない', () => {
      render(<StatusPanel {...makeDefaultProps()} tailscaleIP="100.88.44.12" wsPort={8080} wsRunning={true} />)
      expect(screen.queryByText(/UPDATE/)).not.toBeInTheDocument()
    })

    it('updateError があるとき UPDATE_ERR バナーを表示する', () => {
      render(
        <StatusPanel
          {...makeDefaultProps()}
          tailscaleIP="100.88.44.12"
          wsPort={8080}
          wsRunning={true}
          updateError="network timeout"
        />,
      )
      expect(screen.getByText(/UPDATE_ERR/)).toBeInTheDocument()
      expect(screen.getByText(/network timeout/)).toBeInTheDocument()
    })
  })
})
