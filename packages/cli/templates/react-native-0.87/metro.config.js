const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const {
  createSolidNativeFullReloadPattern,
  createSolidNativeMetroResolver,
  solidNativeTransformWorkerPath,
} = require("@solid-native/metro");

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  transformerPath: solidNativeTransformWorkerPath,
  resolver: {
    resolveRequest: createSolidNativeMetroResolver(__dirname),
    unstable_forceFullRefreshPatterns: [
      createSolidNativeFullReloadPattern(__dirname),
    ],
  },
});
