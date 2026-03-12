import React, { useState } from 'react'
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

  if (connection) {
    return (
      <TerminalScreen
        ip={connection.ip}
        token={connection.token}
        onAuthError={handleDisconnect}
      />
    )
  }

  return <ConnectScreen onConnect={handleConnect} />
}
