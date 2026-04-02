import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { formatDate, PROFILES_KEY, ConnectionProfile } from '../utils'

type Screen = 'list' | 'form' | 'scan'

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function ConnectScreen() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState<Screen>('list')
  const [editTarget, setEditTarget] = useState<ConnectionProfile | null>(null)

  // フォーム入力
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const [token, setToken] = useState('')

  const [permission, requestPermission] = useCameraPermissions()

  useEffect(() => {
    AsyncStorage.getItem(PROFILES_KEY)
      .then((raw) => {
        if (raw) {
          try {
            setProfiles(JSON.parse(raw))
          } catch {
            // 破損データは無視
          }
        }
      })
      .catch(() => {
        // ストレージ読み込みエラーは空リストで続行
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const saveProfiles = useCallback(async (next: ConnectionProfile[]) => {
    setProfiles(next)
    await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(next))
  }, [])

  const handleConnect = useCallback(
    async (profile: ConnectionProfile) => {
      const next = profiles.map((p) =>
        p.id === profile.id ? { ...p, lastConnectedAt: new Date().toISOString() } : p,
      )
      await saveProfiles(next)
      router.push({ pathname: '/session-picker', params: { ip: profile.ip, token: profile.token, profileId: profile.id } })
    },
    [profiles, saveProfiles, router],
  )

  const openNewForm = useCallback(() => {
    setEditTarget(null)
    setName('')
    setIp('')
    setToken('')
    setScreen('form')
  }, [])

  const openEditForm = useCallback((profile: ConnectionProfile) => {
    setEditTarget(profile)
    setName(profile.name)
    setIp(profile.ip)
    setToken(profile.token)
    setScreen('form')
  }, [])

  const handleSave = async () => {
    const trimmedName = name.trim() || ip
    if (editTarget) {
      const next = profiles.map((p) =>
        p.id === editTarget.id ? { ...p, name: trimmedName, ip, token } : p,
      )
      await saveProfiles(next)
    } else {
      const newProfile: ConnectionProfile = { id: generateId(), name: trimmedName, ip, token }
      await saveProfiles([...profiles, newProfile])
    }
    setScreen('list')
  }

  const handleDelete = (profile: ConnectionProfile) => {
    Alert.alert('Delete', `Delete "${profile.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await saveProfiles(profiles.filter((p) => p.id !== profile.id))
        },
      },
    ])
  }

  const handleScanPress = async () => {
    if (!permission?.granted) {
      const result = await requestPermission()
      if (!result.granted) return
    }
    setScreen('scan')
  }

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    try {
      const url = new URL(data)
      if (url.protocol !== 'remocoder:') return
      const scannedIp = url.searchParams.get('ip')
      const scannedToken = url.searchParams.get('token')
      if (scannedIp && scannedToken) {
        setIp(scannedIp)
        setToken(scannedToken)
        setName(url.searchParams.get('name') ?? scannedIp)
        setScreen('form')
      }
    } catch {
      // 対応フォーマット外は無視
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#4caf50" />
      </SafeAreaView>
    )
  }

  if (screen === 'scan') {
    return (
      <SafeAreaView style={styles.scannerContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        />
        <View style={styles.scannerOverlay}>
          <Text style={styles.scannerHint}>Scan the QR code on your desktop</Text>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setScreen('list')}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (screen === 'form') {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>{editTarget ? 'Edit Profile' : 'New Connection'}</Text>

        <TouchableOpacity style={styles.qrButton} onPress={handleScanPress}>
          <Text style={styles.qrButtonText}>Scan QR Code</Text>
        </TouchableOpacity>

        <Text style={styles.divider}>or enter manually</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. MacBook Pro"
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>Tailscale IP</Text>
        <TextInput
          style={styles.input}
          value={ip}
          onChangeText={setIp}
          placeholder="100.x.x.x"
          placeholderTextColor="#555"
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
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('list')}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, (!ip || !token) && styles.disabledButton]}
            onPress={handleSave}
            disabled={!ip || !token}
          >
            <Text style={styles.primaryButtonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>RemoCoder</Text>

      {profiles.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No connections</Text>
          <Text style={styles.emptySubText}>Add a new connection to get started</Text>
        </View>
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <View style={styles.profileCard}>
              <TouchableOpacity style={styles.profileInfo} onPress={() => handleConnect(item)}>
                <Text style={styles.profileName}>{item.name}</Text>
                <Text style={styles.profileIp}>{item.ip}</Text>
                {item.lastConnectedAt && (
                  <Text style={styles.profileLastConnected}>
                    Last connected: {formatDate(item.lastConnectedAt)}
                  </Text>
                )}
              </TouchableOpacity>
              <View style={styles.profileActions}>
                <TouchableOpacity style={styles.editButton} onPress={() => openEditForm(item)}>
                  <Text style={styles.editButtonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButton} onPress={() => handleDelete(item)}>
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.addButton} onPress={openNewForm}>
        <Text style={styles.addButtonText}>+ Add Connection</Text>
      </TouchableOpacity>
    </SafeAreaView>
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
    marginBottom: 24,
    textAlign: 'center',
  },
  list: {
    flex: 1,
    marginBottom: 16,
  },
  profileCard: {
    backgroundColor: '#2d2d2d',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#3d3d3d',
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d4d4d4',
    marginBottom: 2,
  },
  profileIp: {
    fontSize: 12,
    color: '#9d9d9d',
    fontFamily: 'monospace',
  },
  profileLastConnected: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  profileActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  editButtonText: {
    color: '#9d9d9d',
    fontSize: 12,
  },
  deleteButton: {
    backgroundColor: 'rgba(200,50,50,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  deleteButtonText: {
    color: '#f44747',
    fontSize: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    color: '#9d9d9d',
    fontSize: 16,
  },
  emptySubText: {
    color: '#555',
    fontSize: 13,
  },
  addButton: {
    backgroundColor: '#2d5a27',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  addButtonText: {
    color: '#4caf50',
    fontSize: 16,
    fontWeight: '600',
  },
  qrButton: {
    backgroundColor: '#1a3d1a',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  qrButtonText: {
    color: '#4caf50',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 12,
  },
  label: {
    fontSize: 14,
    color: '#9d9d9d',
    marginBottom: 6,
    marginTop: 12,
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
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#2d5a27',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4caf50',
  },
  primaryButtonText: {
    color: '#4caf50',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.4,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#2d2d2d',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3d3d3d',
  },
  secondaryButtonText: {
    color: '#9d9d9d',
    fontSize: 16,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 32,
    alignItems: 'center',
    gap: 16,
  },
  scannerHint: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cancelButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
  },
})
