const VALID_VARIANTS = ['development', 'preview', 'production']

let variant
if (process.env.EAS_BUILD_PROFILE !== undefined) {
  variant = process.env.EAS_BUILD_PROFILE
  console.log(`[app.config.js] variant: "${variant}" (EAS_BUILD_PROFILE)`)
} else if (process.env.APP_VARIANT !== undefined) {
  variant = process.env.APP_VARIANT
  console.log(`[app.config.js] variant: "${variant}" (APP_VARIANT)`)
} else {
  variant = 'production'
  console.log(`[app.config.js] variant: "${variant}" (default)`)
}

if (!VALID_VARIANTS.includes(variant)) {
  throw new Error(
    `[app.config.js] 無効な variant: "${variant}"。有効な値: ${VALID_VARIANTS.join(', ')}`
  )
}

const IS_DEV = variant === 'development'

module.exports = ({ config }) => {
  const version = config.version || '0.0.1'
  const [major, minor, patch] = version.split('.').map(Number)
  // versionCode: MAJOR*1000000 + MINOR*1000 + PATCH (各セグメント最大999まで単調増加を保証)
  const versionCode = major * 1000000 + minor * 1000 + patch

  if (!IS_DEV) {
    if (!config.ios?.bundleIdentifier) {
      throw new Error('[app.config.js] ios.bundleIdentifier が app.json に設定されていません')
    }
    if (!config.android?.package) {
      throw new Error('[app.config.js] android.package が app.json に設定されていません')
    }
  }

  return {
    ...config,
    name: IS_DEV ? 'Remocoder Dev' : config.name,
    icon: IS_DEV ? './assets/icon-dev.png' : './assets/icon.png',
    ios: {
      ...config.ios,
      bundleIdentifier: IS_DEV ? 'com.remocoder.app.dev' : config.ios?.bundleIdentifier,
    },
    android: {
      ...config.android,
      adaptiveIcon: {
        ...(config.android?.adaptiveIcon ?? {}),
        foregroundImage: IS_DEV ? './assets/icon-dev.png' : './assets/icon.png',
      },
      package: IS_DEV ? 'com.remocoder.app.dev' : config.android.package,
      versionCode,
    },
  }
}
