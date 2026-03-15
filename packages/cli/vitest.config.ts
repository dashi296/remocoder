import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@remocoder/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
