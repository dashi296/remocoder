module.exports = ({ config }) => {
  const version = config.version || '0.0.1'
  const [major, minor, patch] = version.split('.').map(Number)
  // versionCode: MAJOR*1000000 + MINOR*1000 + PATCH (各セグメント最大999まで単調増加を保証)
  const versionCode = major * 1000000 + minor * 1000 + patch

  return {
    ...config,
    android: {
      ...config.android,
      versionCode,
    },
  }
}
