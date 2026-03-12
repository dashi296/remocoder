// Type stubs for Expo packages (types are provided after pnpm install)
declare module 'expo-camera' {
  import type React from 'react'
  import type { ViewStyle } from 'react-native'

  export interface BarcodeScanningResult {
    data: string
    type: string
  }

  export interface CameraViewProps {
    style?: ViewStyle
    facing?: 'front' | 'back'
    onBarcodeScanned?: (result: BarcodeScanningResult) => void
    barcodeScannerSettings?: { barcodeTypes: string[] }
    children?: React.ReactNode
  }

  export const CameraView: React.ComponentType<CameraViewProps>

  export interface CameraPermissionResponse {
    granted: boolean
    status: string
  }

  export function useCameraPermissions(): [
    CameraPermissionResponse | null,
    () => Promise<CameraPermissionResponse>,
  ]
}
