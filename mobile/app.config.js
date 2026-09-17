const appJson = require('./app.json');

const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const plugins = [...(appJson.expo.plugins ?? [])];

plugins.push(
  googleMapsApiKey
    ? ['react-native-maps', { androidGoogleMapsApiKey: googleMapsApiKey }]
    : 'react-native-maps'
);

module.exports = {
  ...appJson.expo,
  android: {
    ...appJson.expo.android,
    package: appJson.expo.android?.package ?? 'com.anonymous.gasta',
  },
  ios: {
    ...appJson.expo.ios,
    bundleIdentifier: appJson.expo.ios?.bundleIdentifier ?? 'com.anonymous.gasta',
  },
  plugins,
};
