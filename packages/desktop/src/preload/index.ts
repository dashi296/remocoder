import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // APIs will be added here as features are implemented
})
