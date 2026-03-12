import { contextBridge, ipcRenderer } from 'electron'
import type { SessionInfo } from '@remocoder/shared'

contextBridge.exposeInMainWorld('electronAPI', {
  getTailscaleIP: (): Promise<string | null> => ipcRenderer.invoke('get-tailscale-ip'),
  getToken: (): Promise<string> => ipcRenderer.invoke('get-token'),
  getSessions: (): Promise<SessionInfo[]> => ipcRenderer.invoke('get-sessions'),
  rotateToken: (): Promise<string> => ipcRenderer.invoke('rotate-token'),
  onSessionsUpdate: (cb: (sessions: SessionInfo[]) => void) => {
    ipcRenderer.on('sessions-update', (_event, sessions: SessionInfo[]) => cb(sessions))
  },
  onTokenRotated: (cb: (token: string) => void) => {
    ipcRenderer.on('token-rotated', (_event, token: string) => cb(token))
  },
  onTailscaleIPUpdated: (cb: (ip: string | null) => void) => {
    ipcRenderer.on('tailscale-ip-updated', (_event, ip: string | null) => cb(ip))
  },
})
