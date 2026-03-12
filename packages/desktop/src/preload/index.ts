import { contextBridge, ipcRenderer } from 'electron'
import type { SessionInfo } from '@remocoder/shared'

contextBridge.exposeInMainWorld('electronAPI', {
  getTailscaleIP: (): Promise<string | null> => ipcRenderer.invoke('get-tailscale-ip'),
  getToken: (): Promise<string> => ipcRenderer.invoke('get-token'),
  getSessions: (): Promise<SessionInfo[]> => ipcRenderer.invoke('get-sessions'),
  onSessionsUpdate: (cb: (sessions: SessionInfo[]) => void) => {
    ipcRenderer.on('sessions-update', (_event, sessions: SessionInfo[]) => cb(sessions))
  },
})
