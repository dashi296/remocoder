import { useEffect } from 'react'
import { Alert } from 'react-native'
import * as Updates from 'expo-updates'

export function useOTAUpdate(): void {
  useEffect(() => {
    async function checkAndDownload() {
      // Expo Go や開発環境では OTA は動作しない
      if (typeof __DEV__ !== 'undefined' && __DEV__) return

      try {
        const result = await Updates.checkForUpdateAsync()
        if (!result.isAvailable) return

        await Updates.fetchUpdateAsync()

        Alert.alert(
          'Update Available',
          'Restart the app to apply the latest version?',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Restart',
              onPress: () => Updates.reloadAsync(),
            },
          ],
        )
      } catch (err) {
        // ネットワーク障害や expo-updates 設定ミスは非致命的。ログのみ残す
        console.warn('[useOTAUpdate] OTA チェック/ダウンロード失敗（非致命的）:', err)
      }
    }

    checkAndDownload()
  }, [])
}
