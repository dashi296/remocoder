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
  /** 接続先セッションID。null は新規セッション作成 */
  sessionId?: string | null
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

  const handleSelectSession = (sessionId: string | null) => {
    setState((prev) => ({ ...prev, screen: 'terminal', sessionId }))
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
          onSelectSession={handleSelectSession}
          onBack={handleBack}
        />
      )}
      {state.screen === 'terminal' && (
        <TerminalScreen
          ip={state.ip}
          token={state.token}
          sessionId={state.sessionId}
          onDisconnect={handleDisconnect}
        />
      )}
    </SafeAreaProvider>
  )
}
