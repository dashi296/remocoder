import React, { useState } from 'react'
import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ConnectScreen } from './screens/ConnectScreen'
import { ForceUpdateScreen } from './screens/ForceUpdateScreen'
import { SessionPickerScreen } from './screens/SessionPickerScreen'
import { TerminalScreen } from './screens/TerminalScreen'
import { useForceUpdate } from './hooks/useForceUpdate'
import { useOTAUpdate } from './hooks/useOTAUpdate'

type Screen = 'connect' | 'sessionPicker' | 'terminal'

interface AppState {
  screen: Screen
  ip: string
  token: string
  /** 新規セッションで起動するプロジェクトパス。null は新規セッション（プロジェクトなし） */
  projectPath?: string | null
  /** アタッチする既存セッションID。指定時は projectPath より優先される */
  sessionId?: string | null
}

export default function App() {
  const [state, setState] = useState<AppState>({
    screen: 'connect',
    ip: '',
    token: '',
  })

  const { needsUpdate, storeUrl, message, isChecking } = useForceUpdate()
  useOTAUpdate()

  const handleConnect = (ip: string, token: string) => {
    setState({ screen: 'sessionPicker', ip, token })
  }

  const handleSelectProject = (projectPath: string | null) => {
    setState((prev) => ({ ...prev, screen: 'terminal', projectPath, sessionId: null }))
  }

  const handleAttachSession = (sessionId: string) => {
    setState((prev) => ({ ...prev, screen: 'terminal', sessionId, projectPath: null }))
  }

  const handleBack = () => {
    setState((prev) => ({ ...prev, screen: 'connect' }))
  }

  const handleDisconnect = () => {
    setState({ screen: 'connect', ip: '', token: '' })
  }

  if (isChecking) {
    return (
      <SafeAreaProvider>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#0e7afb" />
        </View>
      </SafeAreaProvider>
    )
  }

  if (needsUpdate) {
    return (
      <SafeAreaProvider>
        <ForceUpdateScreen message={message} storeUrl={storeUrl} />
      </SafeAreaProvider>
    )
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
          onAttachSession={handleAttachSession}
          onBack={handleBack}
        />
      )}
      {state.screen === 'terminal' && (
        <TerminalScreen
          ip={state.ip}
          token={state.token}
          projectPath={state.projectPath}
          sessionId={state.sessionId}
          onDisconnect={handleDisconnect}
        />
      )}
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
