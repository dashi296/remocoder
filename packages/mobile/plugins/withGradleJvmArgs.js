const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withGradleJvmArgs(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) => item.key !== 'org.gradle.jvmargs'
    );
    config.modResults.push({
      type: 'property',
      key: 'org.gradle.jvmargs',
      value: '-Xmx4096m -XX:MaxMetaspaceSize=1024m',
    });
    return config;
  });
};
