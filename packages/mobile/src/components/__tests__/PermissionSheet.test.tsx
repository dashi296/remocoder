import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { PermissionSheet, PermissionRequest } from '../PermissionSheet'

const makeRequest = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: 'req-001',
  toolName: 'Bash',
  details: ['echo hello'],
  requiresAlways: false,
  createdAt: Date.now(),
  ...overrides,
})

describe('PermissionSheet', () => {
  const onDecide = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('request が null のとき何も描画しない', () => {
    render(<PermissionSheet request={null} onDecide={onDecide} />)
    expect(screen.queryByText('Permission Request')).toBeNull()
  })

  it('request があるとき「Permission Request」ラベルを表示する', () => {
    render(<PermissionSheet request={makeRequest()} onDecide={onDecide} />)
    expect(screen.getByText('Permission Request')).toBeTruthy()
  })

  it('ツール名を表示する', () => {
    render(<PermissionSheet request={makeRequest({ toolName: 'Read' })} onDecide={onDecide} />)
    expect(screen.getByText('Read')).toBeTruthy()
  })

  it('TOOL_INFO に登録されたツールの操作説明を表示する', () => {
    render(<PermissionSheet request={makeRequest({ toolName: 'Bash' })} onDecide={onDecide} />)
    expect(screen.getByText('Run shell command')).toBeTruthy()
  })

  it('TOOL_INFO に未登録のツールは操作説明を表示しない', () => {
    render(<PermissionSheet request={makeRequest({ toolName: 'UnknownTool' })} onDecide={onDecide} />)
    expect(screen.queryByText('Run shell command')).toBeNull()
  })

  it('details の内容を表示する', () => {
    render(<PermissionSheet request={makeRequest({ details: ['ls -la', 'pwd'] })} onDecide={onDecide} />)
    expect(screen.getByText('ls -la')).toBeTruthy()
    expect(screen.getByText('pwd')).toBeTruthy()
  })

  it('details が空のとき詳細ボックスを表示しない', () => {
    render(<PermissionSheet request={makeRequest({ details: [] })} onDecide={onDecide} />)
    expect(screen.queryByText('Command')).toBeNull()
  })

  it('「Allow」ボタンを押すと onDecide("approve") が呼ばれる', () => {
    render(<PermissionSheet request={makeRequest()} onDecide={onDecide} />)
    fireEvent.press(screen.getByText('Allow'))
    expect(onDecide).toHaveBeenCalledWith('req-001', 'approve')
  })

  it('「Deny」ボタンを押すと onDecide("reject") が呼ばれる', () => {
    render(<PermissionSheet request={makeRequest()} onDecide={onDecide} />)
    fireEvent.press(screen.getByText('Deny'))
    expect(onDecide).toHaveBeenCalledWith('req-001', 'reject')
  })

  it('requiresAlways=true のとき「Always Allow」ボタンが表示される', () => {
    render(<PermissionSheet request={makeRequest({ requiresAlways: true })} onDecide={onDecide} />)
    expect(screen.getByText('Always Allow')).toBeTruthy()
  })

  it('requiresAlways=false のとき「Always Allow」ボタンが表示されない', () => {
    render(<PermissionSheet request={makeRequest({ requiresAlways: false })} onDecide={onDecide} />)
    expect(screen.queryByText('Always Allow')).toBeNull()
  })

  it('「Always Allow」ボタンを押すと onDecide("always") が呼ばれる', () => {
    render(<PermissionSheet request={makeRequest({ requiresAlways: true })} onDecide={onDecide} />)
    fireEvent.press(screen.getByText('Always Allow'))
    expect(onDecide).toHaveBeenCalledWith('req-001', 'always')
  })

  describe('危険パターンの検出', () => {
    it('rm -rf を含むコマンドで「⚠ 危険」バッジを表示する', () => {
      render(
        <PermissionSheet
          request={makeRequest({ details: ['rm -rf /tmp/foo'] })}
          onDecide={onDecide}
        />,
      )
      expect(screen.getByText('⚠ Danger')).toBeTruthy()
    })

    it('sudo を含むコマンドで「⚠ Danger」バッジを表示する', () => {
      render(
        <PermissionSheet
          request={makeRequest({ details: ['sudo apt-get update'] })}
          onDecide={onDecide}
        />,
      )
      expect(screen.getByText('⚠ Danger')).toBeTruthy()
    })

    it('dd コマンドで「⚠ Danger」バッジを表示する', () => {
      render(
        <PermissionSheet
          request={makeRequest({ details: ['dd if=/dev/zero of=file'] })}
          onDecide={onDecide}
        />,
      )
      expect(screen.getByText('⚠ Danger')).toBeTruthy()
    })

    it('安全なコマンドでは「⚠ Danger」バッジを表示しない', () => {
      render(
        <PermissionSheet
          request={makeRequest({ details: ['echo hello world'] })}
          onDecide={onDecide}
        />,
      )
      expect(screen.queryByText('⚠ Danger')).toBeNull()
    })
  })

  it('request が変わると新しいツール名を表示する', () => {
    const { rerender } = render(
      <PermissionSheet request={makeRequest({ toolName: 'Read' })} onDecide={onDecide} />,
    )
    expect(screen.getByText('Read')).toBeTruthy()

    rerender(<PermissionSheet request={makeRequest({ toolName: 'Write' })} onDecide={onDecide} />)
    expect(screen.getByText('Write')).toBeTruthy()
  })
})
