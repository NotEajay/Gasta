import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, SafeAreaView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/Themed';
import { GasTaColors as C, palette } from '@/constants/Theme';
import CompanyEstimateCard from '@/components/ui/CompanyEstimateCard';
import { DOE_REGIONS } from '@/constants/regions';
import BrandMark from '@/components/ui/BrandMark';
import { fetchSeaoilDirectory, filterStationGeography, isSupportedStationRegion, isSupportedStationArea, stationSearchText, type OfficialStation } from '@/lib/services/stationDirectory';

const StationCard = memo(function StationCard({ station }: { station: OfficialStation }) {
  return <View style={styles.card}>
    <View style={styles.row}>
      <View style={styles.icon}><Ionicons name="business-outline" size={19} color={C.forest} /></View>
      <Text style={[styles.name, { flex: 1 }]}>{station.name}</Text>
    </View>
    {station.address ? <Text style={styles.secondary}>{station.address}</Text> : null}
    {station.operating_hours ? <View style={styles.row}>
      <Ionicons name="time-outline" size={14} color={C.forestMuted} />
      <Text style={styles.secondary}>{station.operating_hours}</Text>
    </View> : null}
    {station.fuel_types.length ? <View style={styles.chips}>
      {station.fuel_types.map((fuel, index) => <Text key={`${fuel}-${index}`} style={styles.fuel}>{fuel}</Text>)}
    </View> : null}
    <View style={styles.chips}><Text style={styles.badge}>Official directory</Text></View>
  </View>;
});

export default function OfficialStationDirectory({
  selectedArea = '', selectedRegion = '', doeSummary, unavailableLabel, onReport, expanded, onToggle,
}: {
  selectedArea?: string;
  selectedRegion?: string;
  unavailableLabel?: string;
  doeSummary?: { price: number | null; sourceLabel: string };
  onReport?: () => void;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [stations, setStations] = useState<OfficialStation[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchSeaoilDirectory().then((rows) => {
      if (cancelled) return;
      setStations(rows); setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [attempt]);
  useEffect(() => { setQuery(''); }, [selectedArea, selectedRegion]);
  const areaSupported = isSupportedStationArea(selectedArea) && isSupportedStationRegion(selectedRegion);
  const regionLabel = DOE_REGIONS.find((item) => item.code === selectedRegion)?.name ?? '';
  const scopeLabel = areaSupported ? [regionLabel, selectedArea].filter(Boolean).join(' • ') : '';
  const areaStations = useMemo(() => filterStationGeography(stations, selectedRegion, selectedArea), [stations, selectedRegion, selectedArea]);
  const indexed = useMemo(() => areaStations.map((station) => ({ station, text: stationSearchText(station) })), [areaStations]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return indexed.filter(({ text }) => !needle || text.includes(needle)).map(({ station }) => station);
  }, [indexed, query]);
  const countLabel = status === 'ready'
    ? areaSupported
      ? `${areaStations.length} official stations${selectedArea || regionLabel ? ` in ${selectedArea || regionLabel}` : ''}`
      : "Station filtering isn't available for this area yet."
    : status === 'error' ? 'Directory unavailable · Tap View stations to retry' : 'Loading official locations…';
  return <>
    <CompanyEstimateCard company="SEAOIL" slug="seaoil"
      price={doeSummary?.price} unavailableLabel={unavailableLabel} sourceLabel={doeSummary?.sourceLabel ?? 'Official station directory'}
      subtitle={countLabel} expanded={expanded} onToggle={onToggle} onReport={onReport}
      onViewStations={() => { setVisible(true); if (status === 'error') setAttempt((value) => value + 1); }}>
      <Text style={styles.name}>Official station directory</Text>
      <Text style={styles.secondary}>{countLabel}</Text>
      {onReport ? <Text style={styles.secondary}>Choose a real station before reporting a price.</Text> : null}
    </CompanyEstimateCard>
    <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.heading}>
          <BrandMark brand="SEAOIL" slug="seaoil" size="sm" />
          <View style={{ flex: 1 }}><Text style={styles.title}>SEAOIL Stations</Text>{scopeLabel ? <Text style={styles.name}>{scopeLabel}</Text> : null}<Text style={styles.secondary}>{status === 'ready' ? `${areaStations.length} official locations` : 'Official company directory'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close station directory" hitSlop={12} onPress={() => setVisible(false)}><Ionicons name="close" size={24} color={C.forest} /></Pressable>
        </View>
        <Text style={[styles.secondary, styles.explanation]}>Branch locations only. DOE prices are area estimates, not exact station pump prices.{selectedArea || selectedRegion ? ' Matches use official addresses; unconfirmed locations are excluded.' : ''}</Text>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={19} color={C.forestMuted} />
          <TextInput accessibilityLabel="Search station name or address" placeholder="Station name or address" placeholderTextColor={C.forestMuted} value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" style={styles.input} />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear station search" hitSlop={8} onPress={() => setQuery('')}><Ionicons name="close-circle" size={19} color={C.forestMuted} /></Pressable> : null}
        </View>
        {status === 'loading' ? <View style={styles.empty}><ActivityIndicator color={C.forest} /><Text style={styles.secondary}>Loading stations…</Text></View> : null}
        {status === 'error' ? <View style={styles.empty}><Text style={styles.name}>Couldn't load stations</Text><Text style={styles.secondary}>Please check your connection and try again.</Text><Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
        {status === 'ready' ? <>
          <Text style={styles.count}>{filtered.length} station{filtered.length === 1 ? '' : 's'}</Text>
          <FlatList data={filtered} keyExtractor={(station) => station.id} renderItem={({ item }) => <StationCard station={item} />} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" initialNumToRender={10} maxToRenderPerBatch={10} contentContainerStyle={styles.list} ListEmptyComponent={<View style={styles.empty}><Text style={styles.name}>No stations found</Text><Text style={styles.secondary}>{query.trim() ? 'Try a different station name or address.' : selectedArea || selectedRegion ? (areaSupported ? 'No official SEAOIL stations found for this area.' : "Station filtering isn't available for this area yet.") : 'Official stations will appear here when available.'}</Text></View>} />
        </> : null}
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.creamLight },
  heading: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', color: C.forestDark },
  explanation: { marginHorizontal: 20, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.forestGlow, alignItems: 'center', justifyContent: 'center' },
  name: { color: C.forestDark, fontSize: 15, fontWeight: '600' },
  secondary: { color: C.forestMuted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  search: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 46, borderRadius: 14, backgroundColor: C.white, borderWidth: 1, borderColor: C.forestBorder },
  input: { flex: 1, minWidth: 0, color: C.forestDark, paddingVertical: 12, fontSize: 14 },
  count: { marginHorizontal: 20, marginVertical: 12, fontSize: 12, color: C.forestMuted },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  card: { backgroundColor: C.glassFillStrong, borderColor: C.glassBorderSubtle, borderWidth: 1, borderRadius: 18, padding: 14, gap: 10, marginBottom: 12, shadowColor: C.forest, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fuel: { backgroundColor: C.cream, color: C.forest, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11 },
  badge: { backgroundColor: palette.primarySoft, color: C.forestMuted, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10 },
  empty: { padding: 24, gap: 12, alignItems: 'center' },
  retry: { backgroundColor: C.forest, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { color: C.creamLight, fontWeight: '600' },
});
