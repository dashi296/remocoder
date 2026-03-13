import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'

const REMOTE_CONFIG_URL =
  'https://raw.githubusercontent.com/dashi296/remocoder/main/remote-config/update.json'

interface RemoteConfig {
  schemaVersion: number
  mobile: {
    minimumNativeVersion: string
    latestVersion: string
    forceUpdateMessage: string
    storeUrls: {
      ios: string
      android: string
    }
  }
}

interface ForceUpdateState {
  needsUpdate: boolean
  storeUrl: string
  message: string
  isChecking: boolean
}

/** a < b → -1, a === b → 0, a > b → 1。pre-release サフィックスは無視する */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/[-+].*$/, '').split('.').map(Number)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const va = isNaN(pa[i]) ? 0 : pa[i]
    const vb = isNaN(pb[i]) ? 0 : pb[i]
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}

export function useForceUpdate(): ForceUpdateState {
  const [state, setState] = useState<ForceUpdateState>({
    needsUpdate: false,
    storeUrl: '',
    message: '',
    isChecking: true,
  })

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await fetch(REMOTE_CONFIG_URL)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const config: RemoteConfig = await res.json()

        const appVersion: string = Constants.expoConfig?.version ?? '0.0.0'
        const { minimumNativeVersion, forceUpdateMessage, storeUrls } = config.mobile

        const needsUpdate = compareSemver(appVersion, minimumNativeVersion) < 0
        const storeUrl = Platform.OS === 'ios' ? storeUrls.ios : storeUrls.android

        if (!cancelled) {
          setState({ needsUpdate, storeUrl, message: forceUpdateMessage, isChecking: false })
        }
      } catch {
        // ネットワークエラー時はチェックをスキップして通常起動
        if (!cancelled) {
          setState({ needsUpdate: false, storeUrl: '', message: '', isChecking: false })
        }
      }
    }

    check()
    return () => { cancelled = true }
  }, [])

  return state
}
