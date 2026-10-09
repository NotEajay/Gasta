import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, SafeAreaView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Themed';
import BrandMark from '@/components/ui/BrandMark';
import { DOE_REGIONS } from '@/constants/regions';
import { GasTaColors as C, radii, spacing } from '@/constants/Theme';
import { fetchCompanyReportStations, filterStationGeography, isSupportedStationArea, isSupportedStationRegion, stationSearchText, type ReportStation } from '@/lib/services/stationDirectory';

export type ReportStationContext = {
  company: string; slug: string; region: string; area: string; fuelType: string;
  doeContext: string;
  source?: 'community-general';
};
export default function ReportStationSelector({ context, onClose }: {
  context: ReportStationContext | null; onClose: () => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [rows, setRows] = useState<ReportStation[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<Record<string, string> | null>(null);
  const closing = useRef(false);
  const supported = !!context && isSupportedStationRegion(context.region) && isSupportedStationArea(context.area);
  useEffect(() => {
    if (!context) return;
    closing.current = false; pending.current = null;
    setVisible(true); setQuery(''); setRows([]); setStatus('loading');
    if (!isSupportedStationRegion(context.region) || !isSupportedStationArea(context.area)) { setStatus('ready'); return; }
    let cancelled = false;
    fetchCompanyReportStations(context.slug).then((stations) => {
      if (!cancelled) { setRows(stations); setStatus('ready'); }
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [context, attempt]);
  const scoped = useMemo(() => context ? filterStationGeography(rows, context.region, context.area) : [], [rows, context]);
  const indexed = useMemo(() => scoped.map((station) => ({ station, text: stationSearchText(station) })), [scoped]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return indexed.filter(({ text }) => !needle || text.includes(needle)).map(({ station }) => station);
  }, [indexed, query]);
  const finishClose = () => {
    if (!closing.current) return;
    closing.current = false;
    const params = pending.current; pending.current = null;
    onClose();
    if (params) router.push({ pathname: '/(tabs)/prices/report', params });
  };
  // iOS waits for native dismissal. With no dismiss animation Android/web can
  // transition after the visibility update has committed; the ref consumes once.
  useEffect(() => {
    if (visible || Platform.OS === 'ios' || !closing.current) return;
    const frame = requestAnimationFrame(finishClose);
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  const close = (station?: ReportStation, another = false) => {
    if (closing.current || !context) return;
    pending.current = station ? {
      station_id: station.id, station_name: station.name,
      brand: station.company.name, station_address: station.address ?? '',
      region: context.region, fuel_type: context.fuelType,
    } : another ? { brand: context.company, region: context.region, fuel_type: context.fuelType } : null;
    if (pending.current && context.source) {
      pending.current.source = context.source;
      pending.current.company_slug = context.slug;
      pending.current.area = context.area;
    }
    closing.current = true; setVisible(false);
  };
  const regionLabel = DOE_REGIONS.find((region) => region.code === context?.region)?.name ?? '';
  return <Modal visible={visible} animationType="none" onDismiss={finishClose} onRequestClose={() => close()}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <BrandMark brand={context?.company} slug={context?.slug} size="sm" />
        <View style={{ flex: 1 }}><Text style={styles.title}>{context?.company} stations</Text><Text style={styles.meta}>{[supported ? context?.area : '', regionLabel].filter(Boolean).join(' · ')}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close station selector" hitSlop={12} onPress={() => close()}><Ionicons name="close" size={24} color={C.forest} /></Pressable>
      </View>
      <View style={styles.search}><Ionicons name="search-outline" size={18} color={C.forestMuted} /><TextInput accessibilityLabel="Search station or address" placeholder="Search station or address" placeholderTextColor={C.forestMuted} autoCorrect={false} value={query} onChangeText={setQuery} style={styles.input} /></View>
      <Text style={styles.note}>Choose the station where you observed the price. DOE figures are area estimates.</Text>
      {!supported ? <Text style={styles.empty}>Station filtering isn't available for this area yet.</Text> : status === 'loading' ? <View style={styles.emptyWrap}><ActivityIndicator color={C.forest} /><Text style={styles.meta}>Loading stations…</Text></View> : status === 'error' ? <View style={styles.emptyWrap}><Text style={styles.title}>Couldn't load stations</Text><Text style={styles.meta}>Please try again.</Text><Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> :
        <FlatList data={matches} keyExtractor={(station) => station.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" initialNumToRender={10} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Report a price at ${item.name}`} onPress={() => close(item)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
          <Ionicons name="location-outline" size={20} color={C.forest} /><View style={{ flex: 1 }}><Text style={styles.name}>{item.name}</Text>{item.address ? <Text style={styles.meta}>{item.address}</Text> : null}{item.source_type === 'official_directory' ? <Text style={styles.badge}>Official directory</Text> : null}</View><Ionicons name="chevron-forward" size={18} color={C.forest} />
        </Pressable>} ListEmptyComponent={<View style={styles.emptyWrap}><Text style={styles.title}>No stations found</Text><Text style={styles.meta}>{query.trim() ? 'Try a different station name or address.' : `We don't have a confidently matched station record for ${context?.company} in this area yet.`}</Text>{!query.trim() ? <Pressable accessibilityRole="button" onPress={() => close(undefined, true)} style={styles.retry}><Text style={styles.retryText}>Report another station</Text></Pressable> : null}</View>} />}
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.creamLight },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  title: { color: C.forestDark, fontSize: 18, fontWeight: '700' },
  name: { color: C.forestDark, fontSize: 14, fontWeight: '600' },
  meta: { color: C.forestMuted, fontSize: 12, lineHeight: 18 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.md, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: C.forestBorder, backgroundColor: C.white },
  input: { flex: 1, color: C.forestDark, paddingVertical: 12, minHeight: 46 },
  note: { fontSize: 12, color: C.forestMuted, margin: spacing.md },
  list: { padding: spacing.md, paddingTop: 0 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radii.md, borderWidth: 1, borderColor: C.glassBorderSubtle, backgroundColor: C.glassFillStrong, marginBottom: 10 },
  badge: { fontSize: 10, color: C.forest, backgroundColor: C.forestGlow, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, alignSelf: 'flex-start', marginTop: 6 },
  empty: { color: C.forestMuted, padding: 24 },
  emptyWrap: { alignItems: 'center', gap: 12, padding: 24 },
  retry: { backgroundColor: C.forest, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  retryText: { color: C.creamLight, fontWeight: '600' },
});
