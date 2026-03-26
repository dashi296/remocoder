import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  resolve: {
    alias: {
      '@remocoder/shared': resolve(__dirname, '../shared/src/index.ts'),
      'qrcode': resolve(__dirname, 'src/renderer/__tests__/__mocks__/qrcode.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    setupFiles: ['./src/renderer/__tests__/setup.ts'],
    include: ['src/renderer/**/*.test.{ts,tsx}', 'src/main/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/renderer/**'],
      exclude: ['src/renderer/**/__tests__/**'],
    },
  },
})
