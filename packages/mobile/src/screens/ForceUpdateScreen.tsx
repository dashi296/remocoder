import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'

interface Props {
  message: string
  storeUrl: string
}

export function ForceUpdateScreen({ message, storeUrl }: Props) {
  const handleUpdate = () => {
    Linking.openURL(storeUrl)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>アップデートが必要です</Text>
      <Text style={styles.message}>{message}</Text>
      <TouchableOpacity style={[styles.button, !storeUrl && styles.buttonDisabled]} onPress={handleUpdate} disabled={!storeUrl}>
        <Text style={styles.buttonText}>ストアでアップデート</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  message: {
    color: '#d4d4d4',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#0e7afb',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  buttonDisabled: {
    backgroundColor: '#555',
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
})
