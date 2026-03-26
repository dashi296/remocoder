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
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
  },
})
