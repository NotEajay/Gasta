import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { colors } from '@/constants/Theme';
import StationMapSurface from './StationMapSurface';
import { createStationMapHtml, readStationMapMessage, type StationMapProps } from './stationMapDocument';

export default function GoogleStationMap({ origin, stations, onSelect }: StationMapProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';
  const mapId = process.env.EXPO_PUBLIC_GOOGLE_MAP_ID?.trim() || 'DEMO_MAP_ID';
  const channel = useMemo(() => `gasta-stations-${Math.random().toString(36).slice(2)}`, [attempt, origin.latitude, origin.longitude, stations]);
  const html = useMemo(() => createStationMapHtml({ origin, stations, apiKey, mapId, channel }), [origin, stations, apiKey, mapId, channel]);
  useEffect(() => setStatus(apiKey ? 'loading' : 'error'), [html, apiKey]);
  const message = useCallback((raw: unknown) => {
    const value = readStationMapMessage(raw, channel, new Set(stations.map((s) => s.placeId)));
    if (value?.type === 'ready') setStatus('ready');
    if (value?.type === 'error') setStatus('error');
    if (value?.type === 'select') onSelect(value.placeId);
  }, [channel, stations, onSelect]);

  return <View style={styles.frame} testID="station-google-map">
    {apiKey ? <StationMapSurface html={html} onMessage={message} onError={() => setStatus('error')} /> : null}
    {status !== 'ready' ? <View style={styles.overlay} accessibilityLiveRegion="polite">
      {status === 'loading' ? <><ActivityIndicator color={colors.primary} /><Text style={styles.message}>Loading Google Maps…</Text></>
        : <><Text style={styles.message}>Google Maps couldn’t load.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry Google Maps" onPress={() => setAttempt((n) => n + 1)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></>}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 160, overflow: 'hidden', backgroundColor: colors.navySoft },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.navySoft, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  message: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.surface, justifyContent: 'center' },
  retryText: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
