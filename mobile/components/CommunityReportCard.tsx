import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import BrandMark from '@/components/ui/BrandMark';
import { GasTaColors as C, colors, palette, radii, spacing } from '@/constants/Theme';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { formatCurrency, formatDate, formatRelativeReportAge } from '@/lib/format';
import { isHistoricalCommunityReport, type PendingCommunityReport } from '@/lib/services/communityReports';

export default function CommunityReportCard({ report, own = false, awaiting = false, action }: {
  report: PendingCommunityReport; own?: boolean; awaiting?: boolean; action?: ReactNode;
}) {
  const historical = report.status === 'verified' && isHistoricalCommunityReport(report);
  const warning = report.status === 'needs_review' || report.status === 'pending';
  const rejected = report.status === 'rejected';
  const label = report.status === 'verified' ? historical ? 'Verified · Historical' : 'Verified'
    : report.status === 'needs_review' ? 'Needs review' : rejected ? 'Rejected'
    : awaiting ? 'Needs confirmation' : 'Pending';
  const tint = rejected ? palette.dangerSoft : warning ? colors.warningSoft : historical ? C.creamDark : C.forestGlow;
  const ink = rejected ? C.error : warning ? colors.warning : historical ? C.forestMuted : C.forest;
  return <View style={styles.card}>
    <View style={styles.header}>
      <BrandMark brand={report.station?.brand_label || report.station?.oil_company?.name} slug={report.station?.oil_company?.slug} stationName={report.station?.name} size="sm" />
      <View style={styles.copy}><Text style={styles.name}>{report.station?.name ?? 'Station'}</Text>{report.station?.oil_company?.name ? <Text style={styles.meta}>{report.station.brand_label || report.station.oil_company.name}</Text> : null}</View>
      <View style={styles.priceColumn}><Text style={styles.price}>{formatCurrency(report.reported_price)}</Text><Text style={styles.unit}>/L</Text></View>
    </View>
    <View style={styles.tags}>
      {own ? <Text style={styles.yours}>Your report</Text> : null}
      {report.fuel_type?.name ? <Text style={styles.fuel}>{report.fuel_type.name}</Text> : null}
      <View style={[styles.status, { backgroundColor: tint }]}><Ionicons name={report.status === 'verified' ? 'shield-checkmark-outline' : 'time-outline'} size={12} color={ink} /><Text style={[styles.statusText, { color: ink }]}>{label}</Text></View>
    </View>
    <Text style={styles.meta}>{report.confirmation_count} {report.status === 'pending' ? `/ ${VERIFY_CONFIRMATIONS_REQUIRED} confirmations` : `confirmation${report.confirmation_count === 1 ? '' : 's'}`} · {formatRelativeReportAge(report.created_at)}{historical ? ` · ${formatDate(report.created_at)}` : ''}</Text>
    {report.status === 'pending' ? <View style={styles.track}><View style={[styles.progress, { width: `${Math.min(100, Math.max(0, report.confirmation_count / VERIFY_CONFIRMATIONS_REQUIRED * 100))}%` }]} /></View> : null}
    {report.station?.address ? <View style={styles.address}><Ionicons name="location-outline" size={13} color={C.forestMuted} /><Text style={[styles.meta, styles.copy]}>{report.station.address}</Text></View> : null}
    {action}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: C.glassFillStrong, borderWidth: 1, borderColor: C.glassBorderSubtle, borderRadius: radii.md, padding: spacing.md, gap: 10, marginBottom: 12, shadowColor: C.forest, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.045, shadowRadius: 5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 }, copy: { flex: 1, minWidth: 0 },
  name: { color: C.forestDark, fontSize: 14, lineHeight: 20, fontWeight: '700' }, meta: { color: C.forestMuted, fontSize: 11, lineHeight: 17 },
  priceColumn: { alignItems: 'flex-end' }, price: { color: C.forestDark, fontSize: 19, fontWeight: '700' }, unit: { color: C.forestMuted, fontSize: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  fuel: { backgroundColor: C.cream, color: C.forest, fontSize: 10, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  yours: { backgroundColor: C.forestGlow, color: C.forest, fontSize: 10, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 4, borderRadius: radii.pill }, statusText: { fontSize: 10, fontWeight: '600' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: C.creamDark }, progress: { height: 4, backgroundColor: C.forestMuted },
  address: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
});
