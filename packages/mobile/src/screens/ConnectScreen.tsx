import React, { useState, useEffect } from 'react'
import { View, TextInput, Button, Text, StyleSheet, ActivityIndicator } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface Props {
  onConnect: (ip: string, token: string) => void
}

export function ConnectScreen({ onConnect }: Props) {
  const [ip, setIp] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    AsyncStorage.getMany(['lastIp', 'lastToken']).then(({ lastIp, lastToken }) => {
      if (lastIp) setIp(lastIp)
      if (lastToken) setToken(lastToken)
      setLoading(false)
    })
  }, [])

  const handleConnect = async () => {
    await AsyncStorage.setMany({ lastIp: ip, lastToken: token })
    onConnect(ip, token)
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Remocoder</Text>
      <Text style={styles.label}>Tailscale IP</Text>
      <TextInput
        style={styles.input}
        value={ip}
        onChangeText={setIp}
        placeholder="100.x.x.x"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>Auth Token</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Button title="接続" onPress={handleConnect} disabled={!ip || !token} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#d4d4d4',
    marginBottom: 32,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    color: '#9d9d9d',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#2d2d2d',
    color: '#d4d4d4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3d3d3d',
  },
})
