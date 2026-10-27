module.exports = function (api) {
  api.cache(true);
  return {
    // NOTE (Expo SDK 58 / expo-router 58): expo-router/babel no longer
    // exists as a package export — babel-preset-expo handles the router
    // transform. Adding 'expo-router/babel' breaks Metro with
    // ERR_PACKAGE_PATH_NOT_EXPORTED.
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
