import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import SelectField from '@/components/ui/SelectField';
import GoogleStationMap from '@/components/maps/GoogleStationMap';
import { colors, spacing } from '@/constants/Theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { resolveCurrentPlace, type ResolvedPlace } from '@/lib/services/location';
import { PlacesAutocompleteError, searchNearbyFuelStations, STATION_BRANDS, STATION_BRAND_LABELS, type NearbyFuelStation, type StationBrand } from '@/lib/services/googlePlacesAutocomplete';
import { publishRouteSelection } from '@/lib/services/routeSelection';

interface Props {
  brand: StationBrand;
  brandName: string;
  priceContext: string;
  priceContexts?: Partial<Record<StationBrand, string>>;
  onClose: () => void;
}

/** Google place details stay in memory for this picker and route handoff. */
export default function NearbyStationPicker({ brand, brandName, priceContext, priceContexts, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [selectedBrand, setSelectedBrand] = useState<StationBrand>(brand);
  const activeBrandName = selectedBrand === brand ? brandName : STATION_BRAND_LABELS[selectedBrand];
  const activePriceContext = selectedBrand === brand ? priceContext : selectedBrand === 'all'
    ? 'Choose a station to plan your drive. Fuel prices may be unavailable.'
    : priceContexts?.[selectedBrand] ?? `Price unavailable for ${activeBrandName} in this selection. You can still plan your drive.`;
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<ResolvedPlace | null>(null);
  const originRef = useRef<ResolvedPlace | null>(null);
  const [resultsBrand, setResultsBrand] = useState<StationBrand | null>(null);
  const [stations, setStations] = useState<NearbyFuelStation[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const selectedStation = resultsBrand === selectedBrand ? stations.find((station) => station.placeId === selectedStationId) ?? null : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true); setError(null); setOrigin(null); setStations([]); setResultsBrand(null); setSelectedStationId(null);
    void (async () => {
      try {
        const place = originRef.current ?? await resolveCurrentPlace({ requestIfNeeded: true, force: true });
        if (cancelled) return;
        if (!place) {
          setError('Allow location access to find stations near you.');
          return;
        }
        originRef.current = place;
        const results = await searchNearbyFuelStations(selectedBrand, place.latitude, place.longitude, controller.signal);
        if (cancelled) return;
        setOrigin(place); setStations(results); setResultsBrand(selectedBrand);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof PlacesAutocompleteError ? reason.userMessage : 'Could not find nearby stations. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [selectedBrand, attempt]);

  function choose(station: NearbyFuelStation) {
    if (!origin || loading || resultsBrand !== selectedBrand) return;
    publishRouteSelection({
      origin: { displayName: origin.city ? `Current location · ${origin.city}` : 'Current location',
        latitude: origin.latitude, longitude: origin.longitude, directionsValue: `${origin.latitude},${origin.longitude}` },
      destination: { displayName: `${station.name} · ${station.address}`, latitude: station.latitude, longitude: station.longitude,
        directionsValue: `${station.latitude},${station.longitude}` },
    });
    onClose();
    router.navigate('/(tabs)/trip');
  }

  return <Modal transparent visible animationType={reduced ? 'none' : 'fade'} onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close nearby stations" onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.header}>
          <View style={styles.copy}><Text accessibilityRole="header" style={styles.title}>{selectedBrand === 'all' ? 'Stations near you' : `${activeBrandName} near you`}</Text>
            <Text style={styles.subtitle}>Choose a station to plan your drive.</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close station search" onPress={onClose} style={styles.close}>
            <MaterialCommunityIcons name="close" size={22} color={colors.navy} />
          </Pressable>
        </View>
        <View style={styles.companySelector}>
          <SelectField label="Company" value={selectedBrand} onChange={setSelectedBrand}
            options={STATION_BRANDS.map((value) => ({ value, label: STATION_BRAND_LABELS[value] }))} appearance="standard" />
        </View>
        <Text style={styles.context}>{activePriceContext}</Text>
        {loading || (!error && resultsBrand !== selectedBrand) ? <View style={styles.status} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} /><Text style={styles.subtitle}>{selectedBrand === 'all' ? 'Finding nearby stations…' : `Finding nearby ${activeBrandName} stations…`}</Text></View>
          : error ? <View style={styles.status}><Text accessibilityRole="alert" style={styles.message}>{error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry nearby station search" onPress={() => setAttempt((n) => n + 1)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View>
          : origin ? <View style={styles.mapContent}>
            <GoogleStationMap origin={origin} stations={stations} onSelect={(placeId) => setSelectedStationId(placeId)} />
            {selectedStation ? <View style={styles.selectedCard} testID="selected-map-station">
              <View style={styles.selectedHeading}><MaterialCommunityIcons name="gas-station-outline" size={19} color={colors.primary} />
                <Text style={styles.name}>{selectedStation.name}</Text></View>
              <Text style={styles.address} numberOfLines={2}>{selectedStation.address}</Text>
              <View style={styles.selectedActions}>
                <Text style={styles.distance}>{selectedStation.distanceKm < 1 ? `${Math.round(selectedStation.distanceKm * 1000)} m` : `${selectedStation.distanceKm.toFixed(1)} km`} away · straight-line</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Plan trip to ${selectedStation.name}, ${selectedStation.address}`}
                  onPress={() => choose(selectedStation)} style={({ pressed }) => [styles.planButton, pressed && styles.pressed]}>
                  <Text style={styles.planText}>Plan trip</Text><MaterialCommunityIcons name="arrow-right" size={16} color={colors.onPrimary} />
                </Pressable>
              </View>
            </View> : <View style={styles.mapHint}><Text style={styles.subtitle}>{stations.length ? `Tap a pin to choose a station · ${stations.length} shown` : selectedBrand === 'all' ? 'No stations found within 30 km.' : `No matching ${activeBrandName} stations found within 30 km.`}</Text></View>}
            {Array.from(new Map(stations.flatMap((station) => station.attributions).map((a) => [a.name + a.uri, a])).values()).map((a, index) => a.uri ? <Text key={index} accessibilityRole="link" onPress={() => void Linking.openURL(a.uri!)} style={styles.provider}>{a.name}</Text> : <Text key={index} style={styles.provider}>{a.name}</Text>)}
          </View> : null}
        <View style={styles.attribution}><Text style={styles.google}>Google Maps</Text></View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(25,45,66,0.45)' },
  sheet: { height: '90%', maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 20, paddingRight: 8, paddingTop: 12 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '700', color: colors.navy },
  subtitle: { fontSize: 12, lineHeight: 18, color: colors.muted },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  companySelector: { paddingHorizontal: 20, paddingTop: 12 },
  context: { marginHorizontal: 20, marginTop: 10, marginBottom: 12, fontSize: 12, lineHeight: 18, color: colors.muted },
  status: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, alignItems: 'center' },
  message: { fontSize: 14, lineHeight: 21, color: colors.navy, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 16, backgroundColor: colors.primarySoft, borderRadius: 12, justifyContent: 'center' },
  retryText: { color: colors.primary, fontWeight: '600' },
  mapContent: { flex: 1, minHeight: 160 },
  mapHint: { paddingHorizontal: 20, paddingTop: 12 },
  selectedCard: { paddingHorizontal: 20, paddingTop: 12 },
  selectedHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.navy },
  address: { fontSize: 12, lineHeight: 18, marginTop: 4, color: colors.muted },
  distance: { flex: 1, fontSize: 11, color: colors.muted },
  planButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  planText: { fontSize: 13, fontWeight: '600', color: colors.onPrimary },
  provider: { fontSize: 12, color: colors.muted, paddingBottom: 8 },
  attribution: { paddingHorizontal: 20, paddingTop: 12 },
  google: { fontSize: 12, fontWeight: '400', color: '#5E5E5E' },
  pressed: { opacity: 0.75 },
});
