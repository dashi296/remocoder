/** @type {import('jest').Config} */
// NOTE: React Native / Expo のソースが追加されたら以下を有効化する
// preset: 'jest-expo' （react-native, expo などのインストールが必要）
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react' } }],
  },
  moduleNameMapper: {
    '^@remocoder/shared$': '<rootDir>/../shared/src/index.ts',
  },
  testMatch: ['**/src/**/__tests__/**/*.{ts,tsx}', '**/src/**/*.test.{ts,tsx}'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
}
