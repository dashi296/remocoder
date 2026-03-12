import React, { useState } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ConnectScreen } from './screens/ConnectScreen'
import { TerminalScreen } from './screens/TerminalScreen'

interface Connection {
  ip: string
  token: string
}

export default function App() {
  const [connection, setConnection] = useState<Connection | null>(null)

  const handleConnect = (ip: string, token: string) => {
    setConnection({ ip, token })
  }

  const handleDisconnect = () => {
    setConnection(null)
  }

  return (
    <SafeAreaProvider>
      {connection ? (
        <TerminalScreen
          ip={connection.ip}
          token={connection.token}
          onDisconnect={handleDisconnect}
        />
      ) : (
        <ConnectScreen onConnect={handleConnect} />
      )}
    </SafeAreaProvider>
  )
}
