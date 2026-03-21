import { describe, it, expect } from 'vitest'
import { DEFAULT_WS_PORT } from '../index'
import type { WsMessage, SessionInfo } from '../index'

describe('DEFAULT_WS_PORT', () => {
  it('8080 であること', () => {
    expect(DEFAULT_WS_PORT).toBe(8080)
  })
})

describe('WsMessage', () => {
  it('input メッセージを組み立てられる', () => {
    const msg: WsMessage = { type: 'input', data: 'hello' }
    expect(msg.type).toBe('input')
    if (msg.type === 'input') expect(msg.data).toBe('hello')
  })

  it('output メッセージを組み立てられる', () => {
    const msg: WsMessage = { type: 'output', data: 'world' }
    expect(msg.type).toBe('output')
  })

  it('auth メッセージを組み立てられる', () => {
    const msg: WsMessage = { type: 'auth', token: 'my-token' }
    expect(msg.type).toBe('auth')
    if (msg.type === 'auth') expect(msg.token).toBe('my-token')
  })

  it('auth_error メッセージが reason を持つ', () => {
    const msg: WsMessage = { type: 'auth_error', reason: 'invalid token' }
    expect(msg.type).toBe('auth_error')
    if (msg.type === 'auth_error') expect(msg.reason).toBe('invalid token')
  })

  it('resize メッセージが cols と rows を持つ', () => {
    const msg: WsMessage = { type: 'resize', cols: 80, rows: 24 }
    expect(msg.type).toBe('resize')
    if (msg.type === 'resize') {
      expect(msg.cols).toBe(80)
      expect(msg.rows).toBe(24)
    }
  })

  it('ping メッセージを組み立てられる', () => {
    const msg: WsMessage = { type: 'ping' }
    expect(msg.type).toBe('ping')
  })

  it('pong メッセージを組み立てられる', () => {
    const msg: WsMessage = { type: 'pong' }
    expect(msg.type).toBe('pong')
  })

  it('auth_ok メッセージを組み立てられる', () => {
    const msg: WsMessage = { type: 'auth_ok', serverName: 'MyServer' }
    expect(msg.type).toBe('auth_ok')
  })
})

describe('SessionInfo', () => {
  it('active ステータスを持つセッションを組み立てられる', () => {
    const session: SessionInfo = {
      id: 'sess-001',
      createdAt: new Date().toISOString(),
      status: 'active',
    }
    expect(session.status).toBe('active')
    expect(session.id).toBe('sess-001')
  })

  it('idle ステータスを持つセッションを組み立てられる', () => {
    const session: SessionInfo = {
      id: 'sess-002',
      createdAt: '2026-03-12T10:00:00.000Z',
      status: 'idle',
    }
    expect(session.status).toBe('idle')
  })

  it('createdAt は ISO 8601 文字列として扱える', () => {
    const iso = '2026-03-12T10:00:00.000Z'
    const session: SessionInfo = { id: '1', createdAt: iso, status: 'active' }
    expect(new Date(session.createdAt).getFullYear()).toBe(2026)
  })
})
