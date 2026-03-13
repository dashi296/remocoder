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
          'アップデートがあります',
          'アプリを再起動して最新バージョンを適用しますか？',
          [
            { text: 'あとで', style: 'cancel' },
            {
              text: '再起動',
              onPress: () => Updates.reloadAsync(),
            },
          ],
        )
      } catch {
        // OTA チェック失敗はサイレントに無視する
      }
    }

    checkAndDownload()
  }, [])
}
