import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../App'

// jsdom 環境では window.electronAPI は未定義のため App は自動的に MOCK_MODE で動作する

describe('App (MOCK_MODE)', () => {
  it('ヘッダーにアプリ名を表示する', async () => {
    render(<App />)
    // 非同期 useEffect の完了を待ってから確認
    await waitFor(() => expect(screen.getByText('CLAUDE CODE')).toBeInTheDocument())
    expect(screen.getByText('REMOTE')).toBeInTheDocument()
  })

  it('ONLINE インジケーターを表示する', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('ONLINE')).toBeInTheDocument())
  })

  it('SYS_STATUS セクションを表示する', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('SYS_STATUS')).toBeInTheDocument())
  })

  it('AUTH_TOKEN セクションを表示する（トークン取得後）', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('AUTH_TOKEN')).toBeInTheDocument())
  })

  it('CONNECTIONS セクションを表示する', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('CONNECTIONS')).toBeInTheDocument())
  })

  it('モック API から Tailscale IP を取得して表示する', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('100.88.44.12')).toBeInTheDocument())
  })

  it('モック API からトークンを取得して TokenDisplay を描画する', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText(/a3f7e291/)).toBeInTheDocument())
  })

  it('モック API からセッション一覧を取得して表示する', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('100.88.44.55')).toBeInTheDocument())
  })

  it('フッターにバージョン情報を表示する', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('v0.1.0')).toBeInTheDocument())
  })
})
