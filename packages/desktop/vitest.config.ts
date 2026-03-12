import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@remocoder/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    setupFiles: ['./src/renderer/__tests__/setup.ts'],
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/renderer/**'],
      exclude: ['src/renderer/**/__tests__/**'],
    },
  },
})
