const { withInfoPlist } = require('@expo/config-plugins');

/**
 * WebView 内から ws:// (Tailscale IP 100.x.x.x) への接続を許可する。
 * NSAllowsLocalNetworking は .local / link-local / loopback のみ対象で
 * Tailscale の 100.x.x.x (RFC 6598) をカバーしないため、
 * NSAllowsArbitraryLoadsInWebContent が必要。
 */
module.exports = function withIosAts(config) {
  return withInfoPlist(config, (config) => {
    const ats = config.modResults.NSAppTransportSecurity || {};
    config.modResults.NSAppTransportSecurity = {
      ...ats,
      NSAllowsLocalNetworking: true,
      NSAllowsArbitraryLoadsInWebContent: true,
    };
    return config;
  });
};
