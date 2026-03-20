import React from 'react'
import { Stack } from 'expo-router'
import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ForceUpdateScreen } from '../src/screens/ForceUpdateScreen'
import { useForceUpdate } from '../src/hooks/useForceUpdate'
import { useOTAUpdate } from '../src/hooks/useOTAUpdate'
import { useNetworkActivityDevTools } from '@rozenite/network-activity-plugin'

export default function RootLayout() {
  useNetworkActivityDevTools()
  const { needsUpdate, storeUrl, message, isChecking } = useForceUpdate()
  useOTAUpdate()

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
      <Stack screenOptions={{ headerShown: false }} />
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
