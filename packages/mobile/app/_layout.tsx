import React from 'react'
import { Stack } from 'expo-router'
import { ActivityIndicator, View, StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ForceUpdateScreen } from '../src/screens/ForceUpdateScreen'
import { useForceUpdate } from '../src/hooks/useForceUpdate'
import { useOTAUpdate } from '../src/hooks/useOTAUpdate'

const queryClient = new QueryClient()
import { useNetworkActivityDevTools } from '@rozenite/network-activity-plugin'

function NetworkActivityDevTools() {
  useNetworkActivityDevTools()
  return null
}

export default function RootLayout() {
  const { needsUpdate, storeUrl, message, isChecking } = useForceUpdate()
  useOTAUpdate()

  if (isChecking) {
    return (
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          {__DEV__ && <NetworkActivityDevTools />}
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#0e7afb" />
          </View>
        </SafeAreaProvider>
      </QueryClientProvider>
    )
  }

  if (needsUpdate) {
    return (
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          {__DEV__ && <NetworkActivityDevTools />}
          <ForceUpdateScreen message={message} storeUrl={storeUrl} />
        </SafeAreaProvider>
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        {__DEV__ && <NetworkActivityDevTools />}
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
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
