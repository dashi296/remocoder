import { withOnBootNetworkActivityRecording } from '@rozenite/network-activity-plugin'

if (__DEV__) {
  withOnBootNetworkActivityRecording()
}

import 'expo-router/entry'
