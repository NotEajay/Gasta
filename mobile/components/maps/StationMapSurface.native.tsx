import { Linking, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { StationMapSurfaceProps } from './stationMapDocument';

export default function StationMapSurface({ html, onMessage, onError }: StationMapSurfaceProps) {
  const configuredSite = process.env.EXPO_PUBLIC_SITE_URL?.trim();
  let baseUrl = 'about:blank';
  try { if (configuredSite?.startsWith('https://')) baseUrl = new URL(configuredSite).origin + '/'; } catch { /* Invalid optional site configuration does not crash the picker. */ }
  return <WebView source={{ html, baseUrl }} style={styles.map} originWhitelist={['*']}
    javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false}
    allowFileAccess={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
    setSupportMultipleWindows={false} allowsLinkPreview={false}
    onMessage={(event) => onMessage(event.nativeEvent.data)} onError={onError} onHttpError={onError}
    onShouldStartLoadWithRequest={(request) => {
      if (request.isTopFrame === false || request.url === 'about:blank' || request.url === baseUrl || request.url.startsWith('data:text/html')) return true;
      if (/^https:\/\/(?:www\.)?(?:google\.com|maps\.google\.com|policies\.google\.com)\//.test(request.url)) {
        void Linking.openURL(request.url).catch(() => {});
      }
      return false;
    }} />;
}
const styles = StyleSheet.create({ map: { flex: 1, backgroundColor: '#EDF1F4' } });
