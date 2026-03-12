import React, { useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ConnectScreen } from './screens/ConnectScreen'
import { SessionPickerScreen } from './screens/SessionPickerScreen'
import { TerminalScreen } from './screens/TerminalScreen'

type Screen = 'connect' | 'sessionPicker' | 'terminal'

interface AppState {
  screen: Screen
  ip: string
  token: string
  /** 起動するプロジェクトのパス。null は新規セッション（プロジェクトなし） */
  projectPath?: string | null
}

export default function App() {
  const [state, setState] = useState<AppState>({
    screen: 'connect',
    ip: '',
    token: '',
  })

  const handleConnect = (ip: string, token: string) => {
    setState({ screen: 'sessionPicker', ip, token })
  }

  const handleSelectProject = (projectPath: string | null) => {
    setState((prev) => ({ ...prev, screen: 'terminal', projectPath }))
  }

  const handleBack = () => {
    setState((prev) => ({ ...prev, screen: 'connect' }))
  }

  const handleDisconnect = () => {
    setState({ screen: 'connect', ip: '', token: '' })
  }

  return (
    <SafeAreaProvider>
      {state.screen === 'connect' && (
        <ConnectScreen onConnect={handleConnect} />
      )}
      {state.screen === 'sessionPicker' && (
        <SessionPickerScreen
          ip={state.ip}
          token={state.token}
          onSelectProject={handleSelectProject}
          onBack={handleBack}
        />
      )}
      {state.screen === 'terminal' && (
        <TerminalScreen
          ip={state.ip}
          token={state.token}
          projectPath={state.projectPath}
          onDisconnect={handleDisconnect}
        />
      )}
    </SafeAreaProvider>
  )
}
