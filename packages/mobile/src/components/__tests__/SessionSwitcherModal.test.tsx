import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { SessionSwitcherModal } from '../SessionSwitcherModal'
import { SessionInfo, ProjectInfo } from '@remocoder/shared'

const makeSession = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 'sess-001',
  createdAt: '2024-01-01T00:00:00.000Z',
  status: 'active',
  ...overrides,
})

const makeProject = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
  path: '/home/user/project',
  name: 'my-project',
  lastUsedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

const defaultProps = {
  visible: true,
  loading: false,
  sessions: [],
  projects: [],
  currentSessionId: null,
  onClose: jest.fn(),
  onSwitchSession: jest.fn(),
  onCreateSession: jest.fn(),
}

describe('SessionSwitcherModal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('visible=false のとき中身を描画しない', () => {
    render(<SessionSwitcherModal {...defaultProps} visible={false} />)
    expect(screen.queryByText('セッション切替')).toBeNull()
  })

  it('visible=true のときタイトルを表示する', () => {
    render(<SessionSwitcherModal {...defaultProps} />)
    expect(screen.getByText('セッション切替')).toBeTruthy()
  })

  it('loading=true のとき「新規セッション」セクションを表示しない', () => {
    render(<SessionSwitcherModal {...defaultProps} loading={true} />)
    expect(screen.queryByText('新規セッション')).toBeNull()
  })

  it('loading=true のときセッション一覧を表示しない', () => {
    const sessions = [makeSession()]
    render(<SessionSwitcherModal {...defaultProps} loading={true} sessions={sessions} />)
    expect(screen.queryByText('実行中のセッション')).toBeNull()
  })

  it('閉じるボタンを押すと onClose が呼ばれる', () => {
    const onClose = jest.fn()
    render(<SessionSwitcherModal {...defaultProps} onClose={onClose} />)
    fireEvent.press(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  describe('セッション一覧', () => {
    it('セッションがあるとき「実行中のセッション」セクションを表示する', () => {
      const sessions = [makeSession()]
      render(<SessionSwitcherModal {...defaultProps} sessions={sessions} />)
      expect(screen.getByText('実行中のセッション')).toBeTruthy()
    })

    it('セッションが空のとき「実行中のセッション」セクションを表示しない', () => {
      render(<SessionSwitcherModal {...defaultProps} sessions={[]} />)
      expect(screen.queryByText('実行中のセッション')).toBeNull()
    })

    it('現在のセッションには「現在」バッジを表示する', () => {
      const sessions = [makeSession({ id: 'sess-001' })]
      render(<SessionSwitcherModal {...defaultProps} sessions={sessions} currentSessionId="sess-001" />)
      expect(screen.getByText('現在')).toBeTruthy()
    })

    it('現在でないセッションには「→」矢印を表示する', () => {
      const sessions = [makeSession({ id: 'sess-001' }), makeSession({ id: 'sess-002' })]
      render(<SessionSwitcherModal {...defaultProps} sessions={sessions} currentSessionId="sess-001" />)
      expect(screen.getByText('→')).toBeTruthy()
    })

    it('非カレントセッションをタップすると onSwitchSession が呼ばれる', () => {
      const onSwitchSession = jest.fn()
      const sessions = [
        makeSession({ id: 'sess-001' }),
        makeSession({ id: 'sess-002' }),
      ]
      render(
        <SessionSwitcherModal
          {...defaultProps}
          sessions={sessions}
          currentSessionId="sess-001"
          onSwitchSession={onSwitchSession}
        />,
      )
      fireEvent.press(screen.getByText('→'))
      expect(onSwitchSession).toHaveBeenCalledWith('sess-002')
    })
  })

  describe('新規セッション', () => {
    it('「プロジェクトなし」ボタンを表示する', () => {
      render(<SessionSwitcherModal {...defaultProps} />)
      expect(screen.getByText('プロジェクトなし')).toBeTruthy()
    })

    it('「プロジェクトなし」ボタンを押すと onCreateSession(null) が呼ばれる', () => {
      const onCreateSession = jest.fn()
      render(<SessionSwitcherModal {...defaultProps} onCreateSession={onCreateSession} />)
      fireEvent.press(screen.getByText('プロジェクトなし'))
      expect(onCreateSession).toHaveBeenCalledWith(null)
    })

    it('プロジェクト一覧を表示する', () => {
      const projects = [makeProject({ name: 'my-project', path: '/home/user/my-project' })]
      render(<SessionSwitcherModal {...defaultProps} projects={projects} />)
      expect(screen.getByText('my-project')).toBeTruthy()
    })

    it('プロジェクトをタップすると onCreateSession(path) が呼ばれる', () => {
      const onCreateSession = jest.fn()
      const projects = [makeProject({ name: 'my-project', path: '/home/user/my-project' })]
      render(<SessionSwitcherModal {...defaultProps} projects={projects} onCreateSession={onCreateSession} />)
      fireEvent.press(screen.getByText('my-project'))
      expect(onCreateSession).toHaveBeenCalledWith('/home/user/my-project')
    })

    it('プロジェクトが空のとき「最近使ったプロジェクトはありません」を表示する', () => {
      render(<SessionSwitcherModal {...defaultProps} projects={[]} />)
      expect(screen.getByText('最近使ったプロジェクトはありません')).toBeTruthy()
    })

    it('プロジェクトがあるとき空メッセージを表示しない', () => {
      const projects = [makeProject()]
      render(<SessionSwitcherModal {...defaultProps} projects={projects} />)
      expect(screen.queryByText('最近使ったプロジェクトはありません')).toBeNull()
    })
  })
})
