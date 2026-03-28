const IS_DEV = process.env.APP_VARIANT === 'development'

module.exports = ({ config }) => {
  const version = config.version || '0.0.1'
  const [major, minor, patch] = version.split('.').map(Number)
  // versionCode: MAJOR*1000000 + MINOR*1000 + PATCH (各セグメント最大999まで単調増加を保証)
  const versionCode = major * 1000000 + minor * 1000 + patch

  return {
    ...config,
    name: IS_DEV ? 'Remocoder Dev' : config.name,
    ios: {
      ...config.ios,
      bundleIdentifier: IS_DEV ? 'com.remocoder.app.dev' : config.ios?.bundleIdentifier,
    },
    android: {
      ...config.android,
      package: IS_DEV ? 'com.remocoder.app.dev' : config.android?.package,
      versionCode,
    },
  }
}
