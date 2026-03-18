import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { PermissionSheet, PermissionRequest } from '../PermissionSheet'

const makeRequest = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: 'req-001',
  toolName: 'Bash',
  details: ['echo hello'],
  requiresAlways: false,
  ...overrides,
})

describe('PermissionSheet', () => {
  const onDecide = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('request が null のとき何も描画しない', () => {
    render(<PermissionSheet request={null} onDecide={onDecide} />)
    expect(screen.queryByText('承認リクエスト')).toBeNull()
  })

  it('request があるとき「承認リクエスト」ラベルを表示する', () => {
    render(<PermissionSheet request={makeRequest()} onDecide={onDecide} />)
    expect(screen.getByText('承認リクエスト')).toBeTruthy()
  })

  it('ツール名を表示する', () => {
    render(<PermissionSheet request={makeRequest({ toolName: 'Read' })} onDecide={onDecide} />)
    expect(screen.getByText('Read')).toBeTruthy()
  })

  it('TOOL_INFO に登録されたツールの操作説明を表示する', () => {
    render(<PermissionSheet request={makeRequest({ toolName: 'Bash' })} onDecide={onDecide} />)
    expect(screen.getByText('シェルコマンドを実行')).toBeTruthy()
  })

  it('TOOL_INFO に未登録のツールは操作説明を表示しない', () => {
    render(<PermissionSheet request={makeRequest({ toolName: 'UnknownTool' })} onDecide={onDecide} />)
    expect(screen.queryByText('シェルコマンドを実行')).toBeNull()
  })

  it('details の内容を表示する', () => {
    render(<PermissionSheet request={makeRequest({ details: ['ls -la', 'pwd'] })} onDecide={onDecide} />)
    expect(screen.getByText('ls -la')).toBeTruthy()
    expect(screen.getByText('pwd')).toBeTruthy()
  })

  it('details が空のとき詳細ボックスを表示しない', () => {
    render(<PermissionSheet request={makeRequest({ details: [] })} onDecide={onDecide} />)
    expect(screen.queryByText('実行コマンド')).toBeNull()
  })

  it('「許可」ボタンを押すと onDecide("approve") が呼ばれる', () => {
    render(<PermissionSheet request={makeRequest()} onDecide={onDecide} />)
    fireEvent.press(screen.getByText('許可'))
    expect(onDecide).toHaveBeenCalledWith('req-001', 'approve')
  })

  it('「拒否」ボタンを押すと onDecide("reject") が呼ばれる', () => {
    render(<PermissionSheet request={makeRequest()} onDecide={onDecide} />)
    fireEvent.press(screen.getByText('拒否'))
    expect(onDecide).toHaveBeenCalledWith('req-001', 'reject')
  })

  it('requiresAlways=true のとき「常に許可」ボタンが表示される', () => {
    render(<PermissionSheet request={makeRequest({ requiresAlways: true })} onDecide={onDecide} />)
    expect(screen.getByText('常に許可')).toBeTruthy()
  })

  it('requiresAlways=false のとき「常に許可」ボタンが表示されない', () => {
    render(<PermissionSheet request={makeRequest({ requiresAlways: false })} onDecide={onDecide} />)
    expect(screen.queryByText('常に許可')).toBeNull()
  })

  it('「常に許可」ボタンを押すと onDecide("always") が呼ばれる', () => {
    render(<PermissionSheet request={makeRequest({ requiresAlways: true })} onDecide={onDecide} />)
    fireEvent.press(screen.getByText('常に許可'))
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
      expect(screen.getByText('⚠ 危険')).toBeTruthy()
    })

    it('sudo を含むコマンドで「⚠ 危険」バッジを表示する', () => {
      render(
        <PermissionSheet
          request={makeRequest({ details: ['sudo apt-get update'] })}
          onDecide={onDecide}
        />,
      )
      expect(screen.getByText('⚠ 危険')).toBeTruthy()
    })

    it('dd コマンドで「⚠ 危険」バッジを表示する', () => {
      render(
        <PermissionSheet
          request={makeRequest({ details: ['dd if=/dev/zero of=file'] })}
          onDecide={onDecide}
        />,
      )
      expect(screen.getByText('⚠ 危険')).toBeTruthy()
    })

    it('安全なコマンドでは「⚠ 危険」バッジを表示しない', () => {
      render(
        <PermissionSheet
          request={makeRequest({ details: ['echo hello world'] })}
          onDecide={onDecide}
        />,
      )
      expect(screen.queryByText('⚠ 危険')).toBeNull()
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
