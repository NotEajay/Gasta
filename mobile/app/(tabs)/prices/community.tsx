import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import CommunityReportCard from '@/components/CommunityReportCard';
import GeneralReportFlow from '@/components/GeneralReportFlow';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { GasTaColors as C, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency } from '@/lib/format';
import {
  canDeleteCommunityReport, communityReportMatchesRecency, confirmCommunityReport,
  deleteCommunityReport, fetchCommunityReports, fetchCommunityReportStatus,
  fetchMyCommunityReports, fetchPendingReports,
  type CommunityRecency, type PendingCommunityReport, type CommunityReport,
} from '@/lib/services/communityReports';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Text } from '@/components/Themed';

const RECENCY_OPTIONS: { value: CommunityRecency; label: string }[] = [
  { value: 'recent', label: 'Recent' }, { value: '7days', label: 'Last 7 Days' },
  { value: '30days', label: 'Last 30 Days' }, { value: 'past', label: 'Past' },
];
type Result = { type: 'confirmation' | 'success' | 'error'; operation: 'confirm' | 'delete'; title: string; message: string };
export default function CommunityPricesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ report_flow?: string; report_company?: string; report_region?: string; report_area?: string; report_request?: string }>();
  const { user, loading: authLoading } = useAuth();
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [pendingAwaiting, setPendingAwaiting] = useState<PendingCommunityReport[]>([]);
  const [mine, setMine] = useState<PendingCommunityReport[]>([]);
  const [recency, setRecency] = useState<CommunityRecency>('recent');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingCommunityReport | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const actionBusy = useRef(false);
  const loadSequence = useRef(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportInitial, setReportInitial] = useState<{ company: string; region: string; area: string } | undefined>();
  const lastResume = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (params.report_flow !== 'community-general' || !params.report_request || lastResume.current === params.report_request) return;
    lastResume.current = params.report_request;
    setReportInitial({ company: params.report_company ?? '', region: params.report_region ?? '', area: params.report_area ?? '' });
    setReportOpen(true);
  }, [params.report_flow, params.report_request, params.report_company, params.report_region, params.report_area]);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    const sequence = ++loadSequence.current;
    let partialFailure = false;
    try {
      const [allReports, awaiting, own] = await Promise.all([
        fetchCommunityReports(200, { recency }),
        // Confirmation queue intentionally stays independent of the period.
        fetchPendingReports(50).catch(() => { partialFailure = true; return []; }),
        user ? fetchMyCommunityReports(user.id).catch(() => { partialFailure = true; return []; }) : Promise.resolve([]),
      ]);
      if (sequence !== loadSequence.current) return;
      setReports(allReports); setPendingAwaiting(awaiting); setMine(own);
      setLoadError(partialFailure ? "Couldn't load all community prices. Pull to refresh or try again." : null);
    } catch {
      if (sequence === loadSequence.current) setLoadError("Couldn't load community prices. Pull to refresh or try again.");
    } finally {
      if (sequence === loadSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [user, recency]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const displayedReports = useMemo(() => reports.filter((report) => communityReportMatchesRecency(report.created_at, recency)).filter((report) => report.status !== 'pending'), [reports, recency]);

  const handleConfirm = async (report: PendingCommunityReport) => {
    if (!user) { router.push('/login'); return; }
    if (actionBusy.current || report.reported_by === user.id) return;
    actionBusy.current = true; setConfirmingId(report.id);
    try {
      await confirmCommunityReport(report.id);
      const updated = await fetchCommunityReportStatus(report.id).catch(() => null);
      await load();
      setResult(updated?.status === 'verified'
        ? { type: 'success', operation: 'confirm', title: 'Price verified', message: 'This report now has enough independent confirmations.' }
        : { type: 'success', operation: 'confirm', title: 'Price confirmed', message: `Your confirmation was recorded.${updated?.status === 'pending' ? ` ${updated.confirmation_count} of ${VERIFY_CONFIRMATIONS_REQUIRED} confirmations received.` : ''}` });
    } catch {
      setResult({ type: 'error', operation: 'confirm', title: "Couldn't confirm price", message: "Couldn't confirm this price. Please try again." });
    } finally { actionBusy.current = false; setConfirmingId(null); }
  };
  const requestDelete = (report: PendingCommunityReport) => {
    if (actionBusy.current || !canDeleteCommunityReport(report.status) || report.reported_by !== user?.id) return;
    setPendingDelete(report);
    setResult({ type: 'confirmation', operation: 'delete', title: 'Delete price report?', message: `Your ${formatCurrency(report.reported_price)}/L report for ${report.station?.name ?? 'this station'} will be removed.` });
  };
  const runDelete = async () => {
    const report = pendingDelete;
    if (!report || actionBusy.current || !canDeleteCommunityReport(report.status) || report.reported_by !== user?.id) return;
    actionBusy.current = true; setDeletingId(report.id);
    try {
      await deleteCommunityReport(report.id);
      setMine((rows) => rows.filter((row) => row.id !== report.id));
      await load();
      setResult({ type: 'success', operation: 'delete', title: 'Report deleted', message: 'Your reported price was removed.' });
    } catch {
      setResult({ type: 'error', operation: 'delete', title: "Couldn't delete report", message: "Couldn't delete this report. Please try again." });
    } finally { actionBusy.current = false; setDeletingId(null); }
  };
  const closeResult = () => { if (!actionBusy.current) { setResult(null); setPendingDelete(null); } };
  if (!isSupabaseConfigured) return <View style={styles.flex}><SupabaseSetupBanner /></View>;
  if (authLoading || loading) return <LoadingState message="Loading community prices…" />;
  return <>
    <ScrollView style={styles.flex} contentContainerStyle={styles.padding} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={C.forest} />}>
      <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.back}><Ionicons name="chevron-back" size={18} color={C.forest} /><Text style={styles.backText}>Back</Text></Pressable>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={styles.title}>Community Prices</Text><Text style={styles.meta}>Verified by {VERIFY_CONFIRMATIONS_REQUIRED} users within ±₱0.50/L</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Report a price" onPress={() => { setReportInitial(undefined); setReportOpen(true); }} style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}><Ionicons name="add" size={16} color={C.white} /><Text style={styles.reportText}>Report a price</Text></Pressable>
      </View>
      <Text style={styles.filterLabel}>Report period</Text>
      <View style={styles.chips}>{RECENCY_OPTIONS.map((option) => <Pressable key={option.value} accessibilityRole="tab" accessibilityState={{ selected: recency === option.value }} onPress={() => setRecency(option.value)} style={[styles.chip, recency === option.value && styles.chipActive]}><Text style={[styles.chipText, recency === option.value && styles.chipTextActive]}>{option.label}</Text></Pressable>)}</View>
      {loadError ? <View style={styles.notice}><Text style={styles.meta}>{loadError}</Text><Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.link}>Try again</Text></Pressable></View> : null}
      <Text style={styles.section}>Community Station Reports</Text>
      {!displayedReports.length ? <EmptyState variant="canonical" title="No community prices yet" message="No verified reports are available for this period." /> : displayedReports.map((report) => <CommunityReportCard key={report.id} report={report} />)}
      {user ? <>
        <Text style={styles.sectionTop}>My reports</Text>
        {!mine.length ? <EmptyState variant="canonical" title="No reports yet" message="Prices you report will appear here." /> : mine.map((report) => <CommunityReportCard key={report.id} report={report} own action={canDeleteCommunityReport(report.status) ? <Pressable accessibilityRole="button" accessibilityLabel={`Delete your report at ${report.station?.name ?? 'this station'}`} disabled={deletingId !== null || confirmingId !== null} onPress={() => requestDelete(report)} style={styles.deleteButton}><Ionicons name="trash-outline" size={14} color={C.error} /><Text style={styles.deleteText}>{deletingId === report.id ? 'Deleting…' : 'Delete report'}</Text></Pressable> : <Text style={styles.meta}>{report.status === 'verified' ? "Verified reports can't be withdrawn — other drivers rely on them." : 'Only pending reports can be withdrawn.'}</Text>} />)}
      </> : null}
      <Text style={styles.sectionTop}>Needs confirmation</Text>
      {!user ? <AuthPrompt message="Sign in to confirm community price reports." onSignIn={() => router.push('/login')} /> : !pendingAwaiting.length ? <EmptyState variant="canonical" title="All caught up" message="There are no reports waiting for confirmation." /> : pendingAwaiting.map((report) => <CommunityReportCard key={report.id} report={report} awaiting action={report.reported_by === user.id ? <Text style={styles.meta}>You reported this price. Other drivers can confirm it.</Text> : <Pressable accessibilityRole="button" accessibilityLabel={`Confirm the price at ${report.station?.name ?? 'this station'}`} accessibilityState={{ busy: confirmingId === report.id }} disabled={confirmingId !== null || deletingId !== null} onPress={() => void handleConfirm(report)} style={styles.confirmButton}>{confirmingId === report.id ? <ActivityIndicator size="small" color={C.white} /> : <Ionicons name="checkmark" size={16} color={C.white} />}<Text style={styles.confirmText}>{confirmingId === report.id ? 'Confirming…' : 'Price is accurate'}</Text></Pressable>} />)}
    </ScrollView>
    <GeneralReportFlow open={reportOpen} initial={reportInitial} onClose={() => setReportOpen(false)} />
    <Modal visible={result !== null} transparent animationType="fade" onRequestClose={closeResult}>
      <Pressable style={styles.backdrop} onPress={closeResult}><Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
        <View style={[styles.resultIcon, result?.type === 'confirmation' || result?.type === 'error' ? { backgroundColor: palette.dangerSoft } : null]}><Ionicons name={result?.type === 'confirmation' ? 'trash-outline' : result?.type === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={27} color={result?.type === 'confirmation' || result?.type === 'error' ? C.error : C.forest} /></View>
        <Text style={styles.modalTitle}>{result?.title}</Text><Text style={styles.modalMessage}>{result?.message}</Text>
        <View style={styles.modalActions}>
          {result?.type === 'confirmation' ? <Pressable accessibilityRole="button" disabled={deletingId !== null} onPress={closeResult} style={styles.cancel}><Text style={styles.link}>Cancel</Text></Pressable> : null}
          <Pressable accessibilityRole="button" disabled={deletingId !== null} onPress={() => result?.type === 'confirmation' ? void runDelete() : closeResult()} style={[styles.modalPrimary, result?.type === 'confirmation' && { backgroundColor: C.error }]}>{deletingId ? <ActivityIndicator color={C.white} /> : <Text style={styles.confirmText}>{result?.type === 'confirmation' ? 'Delete' : result?.type === 'error' ? 'Try again' : 'Done'}</Text>}</Pressable>
        </View>
      </Pressable></Pressable>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.creamLight }, padding: { padding: spacing.lg, paddingBottom: spacing.xxl, maxWidth: 660, width: '100%', alignSelf: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: 12 }, backText: { color: C.forest, fontSize: 14, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }, title: { color: C.forestDark, fontSize: 24, fontWeight: '700' }, meta: { color: C.forestMuted, fontSize: 12, lineHeight: 18 },
  reportButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.forest, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 9 }, reportText: { color: C.white, fontSize: 12, fontWeight: '600' },
  filterLabel: { color: C.forestMuted, fontSize: 10, fontWeight: '600', marginBottom: 8 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }, chip: { borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.forestBorder, backgroundColor: C.white }, chipActive: { backgroundColor: C.forest }, chipText: { color: C.forest, fontSize: 11, fontWeight: '600' }, chipTextActive: { color: C.creamLight },
  section: { color: C.forestDark, fontSize: 17, fontWeight: '700', marginBottom: 10 }, sectionTop: { color: C.forestDark, fontSize: 17, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  notice: { backgroundColor: C.cream, borderRadius: 12, padding: 12, gap: 8, marginBottom: 16 }, link: { color: C.forest, fontSize: 12, fontWeight: '600' },
  deleteButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.pill, borderWidth: 1, borderColor: C.glassBorderSubtle }, deleteText: { color: C.error, fontSize: 11, fontWeight: '600' },
  confirmButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, backgroundColor: C.forest, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9 }, confirmText: { color: C.white, fontSize: 12, fontWeight: '600' }, pressed: { opacity: 0.75 },
  backdrop: { flex: 1, backgroundColor: C.forestMuted, justifyContent: 'center', padding: 24 }, modalCard: { backgroundColor: C.creamLight, borderRadius: 22, padding: 24, maxWidth: 420, width: '100%', alignSelf: 'center', gap: 14 }, resultIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.forestGlow, alignItems: 'center', justifyContent: 'center' }, modalTitle: { color: C.forestDark, fontSize: 20, fontWeight: '700' }, modalMessage: { color: C.forestMuted, fontSize: 14, lineHeight: 21 }, modalActions: { flexDirection: 'row', alignItems: 'center', gap: 12 }, modalPrimary: { flex: 1, minHeight: 46, backgroundColor: C.forest, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, cancel: { paddingHorizontal: 12, paddingVertical: 12 },
});
