import React from 'react'
import { View } from 'react-native'

export const CameraView = ({ children }: { children?: React.ReactNode }) => (
  <View testID="camera-view">{children}</View>
)

export function useCameraPermissions(): [
  { granted: boolean } | null,
  () => Promise<{ granted: boolean }>,
] {
  return [{ granted: false }, async () => ({ granted: true })]
}
