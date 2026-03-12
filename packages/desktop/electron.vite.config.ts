import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@remocoder/shared'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@remocoder/shared'] })],
  },
  renderer: {
    plugins: [react()],
  },
})
