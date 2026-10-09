import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import BrandMark from '@/components/ui/BrandMark';
import ReportStationSelector, { type ReportStationContext } from '@/components/ReportStationSelector';
import { DOE_REGIONS } from '@/constants/regions';
import { GasTaColors as C, radii, spacing } from '@/constants/Theme';
import { fetchOilCompanies } from '@/lib/services/communityReports';
import { isSupportedStationRegion, supportedStationAreas } from '@/lib/services/stationDirectory';

type Company = { id: string; name: string; slug: string };
export default function GeneralReportFlow({ open, onClose, initial }: {
  open: boolean; onClose: () => void;
  initial?: { company: string; region: string; area: string };
}) {
  const [visible, setVisible] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [region, setRegion] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<ReportStationContext | null>(null);
  const transition = useRef<{ context: ReportStationContext | null } | null>(null);
  useEffect(() => {
    if (!open) return;
    setVisible(true); setCompany(null); setContext(null); setStatus('loading');
    setRegion(initial?.region && isSupportedStationRegion(initial.region) ? initial.region : '');
    setArea(initial?.area ?? ''); transition.current = null;
    let cancelled = false;
    fetchOilCompanies().then((rows) => {
      if (cancelled) return;
      setCompanies(rows); setCompany(rows.find((row) => row.slug === initial?.company) ?? null); setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [open, initial, attempt]);
  const areas = useMemo(() => supportedStationAreas(region), [region]);
  const finishClose = () => {
    const next = transition.current;
    if (!next) return;
    transition.current = null;
    if (next.context) setContext(next.context);
    else onClose();
  };
  useEffect(() => {
    if (visible || Platform.OS === 'ios' || !transition.current) return;
    const frame = requestAnimationFrame(finishClose);
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  const close = (next: ReportStationContext | null = null) => {
    if (transition.current) return;
    transition.current = { context: next }; setVisible(false);
  };
  return <>
    <Modal visible={visible} animationType="none" onDismiss={finishClose} onRequestClose={() => close()}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}><Text style={styles.title}>{company ? 'Choose location' : 'Choose fuel company'}</Text><Text style={styles.meta}>{company ? 'Select a region before browsing real stations.' : 'Select the company for the station where you saw the price.'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close reporting flow" hitSlop={12} onPress={() => close()}><Ionicons name="close" size={24} color={C.forest} /></Pressable>
        </View>
        {status === 'loading' ? <View style={styles.empty}><ActivityIndicator color={C.forest} /><Text style={styles.meta}>Loading companies…</Text></View> : status === 'error' ? <View style={styles.empty}><Text style={styles.meta}>Couldn't load companies. Please try again.</Text><Pressable accessibilityRole="button" style={styles.primary} onPress={() => setAttempt((value) => value + 1)}><Text style={styles.primaryText}>Try again</Text></Pressable></View> :
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {!company ? companies.length ? companies.map((row) => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`Choose ${row.name}`} style={({ pressed }) => [styles.company, pressed && { opacity: 0.7 }]} onPress={() => { setCompany(row); setRegion(''); setArea(''); }}>
              <BrandMark brand={row.name} slug={row.slug} size="sm" /><Text style={[styles.name, { flex: 1 }]}>{row.name}</Text><Ionicons name="chevron-forward" size={18} color={C.forest} />
            </Pressable>) : <View style={styles.empty}><Text style={styles.name}>No companies available</Text><Text style={styles.meta}>Please try again later.</Text></View> : <>
              <View style={styles.company}><BrandMark brand={company.name} slug={company.slug} size="sm" /><Text style={styles.name}>{company.name}</Text><Pressable accessibilityRole="button" onPress={() => setCompany(null)}><Text style={styles.link}>Change company</Text></Pressable></View>
              <Text style={styles.label}>Region</Text>
              <View style={styles.chips}>{DOE_REGIONS.map((item) => <Pressable key={item.code} accessibilityRole="button" accessibilityState={{ selected: region === item.code }} onPress={() => { setRegion(item.code); setArea(''); }} style={[styles.chip, region === item.code && styles.selected]}><Text style={[styles.chipText, region === item.code && styles.selectedText]}>{item.name}</Text></Pressable>)}</View>
              {region ? <>
                <Text style={styles.label}>Area (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.areaChips}>
                  {['', ...areas].map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: area === item }} onPress={() => setArea(item)} style={[styles.chip, area === item && styles.selected]}><Text style={[styles.chipText, area === item && styles.selectedText]}>{item || 'Any area in this region'}</Text></Pressable>)}
                </ScrollView>
                <Text style={styles.meta}>Station matches use stored addresses. Unconfirmed locations are excluded.</Text>
              </> : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Choose station" disabled={!region} style={[styles.primary, !region && { opacity: 0.45 }]} onPress={() => {
                if (!region || !isSupportedStationRegion(region)) return;
                close({ company: company.name, slug: company.slug, region, area, fuelType: 'RON_91', doeContext: '', source: 'community-general' });
              }}><Text style={styles.primaryText}>Choose station</Text></Pressable>
            </>}
          </ScrollView>}
      </SafeAreaView>
    </Modal>
    <ReportStationSelector context={context} onClose={() => { setContext(null); onClose(); }} />
  </>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.creamLight }, header: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: spacing.lg },
  title: { color: C.forestDark, fontSize: 22, fontWeight: '700' }, meta: { color: C.forestMuted, fontSize: 12, lineHeight: 18 },
  name: { color: C.forestDark, fontSize: 14, fontWeight: '600' }, content: { padding: spacing.lg, paddingTop: 0, gap: 12 },
  company: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radii.md, borderWidth: 1, borderColor: C.forestBorder, backgroundColor: C.glassFillStrong },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, areaChips: { gap: 8, paddingBottom: 8 },
  chip: { borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.forestBorder, backgroundColor: C.white },
  selected: { backgroundColor: C.forest }, chipText: { color: C.forest, fontSize: 12 }, selectedText: { color: C.creamLight },
  label: { color: C.forestMuted, fontSize: 12, fontWeight: '600' }, link: { color: C.forest, fontSize: 12, fontWeight: '600' },
  primary: { alignItems: 'center', borderRadius: 14, backgroundColor: C.forest, padding: 14, marginTop: 12 }, primaryText: { color: C.white, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 12, padding: 24 },
});
