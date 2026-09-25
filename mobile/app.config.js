/**
 * Keep the public map-display key separate from the server-only Directions key.
 * Expo Go supplies the native map runtime; standalone Android builds need the
 * same public key wired into react-native-maps through its config plugin.
 */
module.exports = ({ config }) => {
  const publicMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const plugins = [...(config.plugins ?? [])];
  const hasMapsPlugin = plugins.some(
    (plugin) =>
      plugin === "react-native-maps" ||
      (Array.isArray(plugin) && plugin[0] === "react-native-maps"),
  );

  if (!hasMapsPlugin) {
    plugins.push([
      "react-native-maps",
      publicMapsKey ? { androidGoogleMapsApiKey: publicMapsKey } : {},
    ]);
  }

  return {
    ...config,
    plugins,
  };
};
