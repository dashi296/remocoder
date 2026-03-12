/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react',
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@remocoder/shared$': '<rootDir>/../shared/src/index.ts',
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts',
    '^react-native-webview$': '<rootDir>/src/__mocks__/react-native-webview.tsx',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/src/__mocks__/async-storage.ts',
    '^expo-camera$': '<rootDir>/src/__mocks__/expo-camera.tsx',
    '^react-native-safe-area-context$': '<rootDir>/src/__mocks__/react-native-safe-area-context.tsx',
  },
  testMatch: ['**/src/**/__tests__/**/*.{ts,tsx}', '**/src/**/*.test.{ts,tsx}'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
}
