// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecAsync = vi.hoisted(() => vi.fn())

vi.mock('child_process', async () => {
  const { promisify } = await import('util')
  const exec = vi.fn()
  ;(exec as any)[promisify.custom] = mockExecAsync
  return { exec }
})

describe('getTailscaleIP', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExecAsync.mockReset()
  })

  it('stdout をトリムした文字列を返す', async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: '100.64.0.1\n', stderr: '' })
    const { getTailscaleIP } = await import('../tailscale')
    expect(await getTailscaleIP()).toBe('100.64.0.1')
  })

  it('execAsync が throw した場合 null を返す', async () => {
    mockExecAsync.mockRejectedValueOnce(new Error('tailscale: command not found'))
    const { getTailscaleIP } = await import('../tailscale')
    expect(await getTailscaleIP()).toBeNull()
  })
})
