const path = require('path')
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getSentryExpoConfig(projectRoot)

// monorepo: workspace ルートの node_modules も参照する
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// pnpm symlink 対応
config.resolver.unstable_enableSymlinks = true

// pnpm モノレポで複数の React インスタンスが生成されるのを防ぐ
config.resolver.extraNodeModules = {
  'react': path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  '@sentry/react-native': path.resolve(projectRoot, 'node_modules/@sentry/react-native'),
}

module.exports = config