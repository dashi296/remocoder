import { formatDate, getSessionDisplayName } from '../utils'

describe('formatDate', () => {
  it('ISO日付文字列を英語の月日時分形式でフォーマットする', () => {
    const result = formatDate('2024-06-15T09:30:00.000Z')
    expect(result).toMatch(/[A-Z][a-z]+ \d+/)
    expect(result).toMatch(/\d{2}:\d{2}/)
  })

  it('不正な日付文字列でも例外を投げない', () => {
    expect(() => formatDate('not-a-date')).not.toThrow()
  })

  it('文字列を返す', () => {
    expect(typeof formatDate('2024-01-01T00:00:00.000Z')).toBe('string')
  })
})

describe('getSessionDisplayName', () => {
  it('projectPath のベース名（末尾セグメント）を返す', () => {
    expect(getSessionDisplayName({ projectPath: '/home/user/my-project' })).toBe('my-project')
  })

  it('深いネストのパスでも末尾セグメントを返す', () => {
    expect(getSessionDisplayName({ projectPath: '/a/b/c/deep-project' })).toBe('deep-project')
  })

  it('末尾スラッシュ付きパスでもベース名を返す', () => {
    expect(getSessionDisplayName({ projectPath: '/home/user/project/' })).toBe('project')
  })

  it('projectPath が undefined の場合 "Session" を返す', () => {
    expect(getSessionDisplayName({ projectPath: undefined })).toBe('Session')
  })

  it('projectPath が空文字列の場合 "Session" を返す', () => {
    expect(getSessionDisplayName({ projectPath: '' })).toBe('Session')
  })

  it('ルートパス "/" の場合 "Session" を返す', () => {
    expect(getSessionDisplayName({ projectPath: '/' })).toBe('Session')
  })
})
