import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import LoadingState from '@/components/ui/LoadingState';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  confirmationsLabel,
  confirmCommunityReport,
  fetchFreshVerifiedPrices,
  fetchPendingReports,
  type PendingCommunityReport,
  type VerifiedCommunityPrice,
} from '@/lib/services/communityReports';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Text } from '@/components/Themed';

/*
 * Centred content column, matching the main Prices shell. On phones the cap
 * never binds, so the column is effectively full width.
 */
const SHELL_MAX_WIDTH = 660;

export default function CommunityPricesScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [verified, setVerified] = useState<VerifiedCommunityPrice[]>([]);
  const [pending, setPending] = useState<PendingCommunityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [v, p] = await Promise.all([
        fetchFreshVerifiedPrices(),
        fetchPendingReports(),
      ]);
      setVerified(v);
      setPending(p);
    } catch (e) {
      console.warn('Community prices load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Reset state and reload to ensure fresh data from database
      setVerified([]);
      setPending([]);
      void load();
    }, [load])
  );

  const handleConfirm = async (report: PendingCommunityReport) => {
    if (!user) {
      router.push('/login');
      return;
    }
    setConfirmingId(report.id);
    try {
      await confirmCommunityReport(report.id);
      Alert.alert(
        'Confirmed',
        report.confirmation_count + 1 >= VERIFY_CONFIRMATIONS_REQUIRED
          ? 'Report is now verified for display.'
          : confirmationsLabel(report.confirmation_count + 1)
      );
      await load();
    } catch (e) {
      Alert.alert('Could not confirm', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setConfirmingId(null);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState message="Loading community prices…" />;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.padding,
        { maxWidth: SHELL_MAX_WIDTH, alignSelf: 'center', width: '100%' },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={GasTaColors.forest}
        />
      }>
      {/* Header carries the report action so it is reachable from the top of
          the screen rather than only at the bottom. Route is unchanged. */}
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Community Prices</Text>
          <Text style={styles.headerMeta}>
            Verified by {VERIFY_CONFIRMATIONS_REQUIRED} users within ±₱0.50/L
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report a price"
          hitSlop={8}
          onPress={() => router.push('/(tabs)/prices/report')}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
          <Text style={styles.headerActionText}>+ Report a price</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Verified · fresh 7 days</Text>
      {verified.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No verified community prices yet</Text>
          <Text style={styles.emptyLine}>
            Report a price you saw, then ask others to confirm it at the station.
          </Text>
        </View>
      ) : (
        <View style={[styles.list, styles.verifiedList]}>
          {verified.map((row, index) => (
            <View
              key={row.report_id}
              style={[
                styles.row,
                index < verified.length - 1 && styles.divider,
              ]}>
              <View style={styles.rowMain}>
                <Text style={styles.station} numberOfLines={1}>
                  {row.station_name}
                </Text>
                <View style={styles.metaRow}>
                  <View style={styles.verifiedPill}>
                    <MaterialCommunityIcons
                      name="shield-check"
                      size={10}
                      color={GasTaColors.forest}
                    />
                    <Text style={styles.verifiedText}>
                      Verified {formatDate(row.verified_at)}
                    </Text>
                  </View>
                </View>
              </View>
              <Text style={styles.price}>
                {formatCurrency(row.reported_price)}
                <Text style={styles.priceUnit}>/L</Text>
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitleTop}>Needs confirmation</Text>
      {!user ? (
        <AuthPrompt
          message="Sign in to confirm community price reports."
          onSignIn={() => router.push('/login')}
        />
      ) : pending.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
          <Text style={styles.emptyLine}>No pending reports waiting for confirmation.</Text>
        </View>
      ) : (
        <View style={[styles.list, styles.pendingList]}>
          {pending.map((report, index) => {
            const isLast = index === pending.length - 1;
            return (
              <View
                key={report.id}
                style={[styles.row, styles.rowStacked, !isLast && styles.divider]}>
                <View style={styles.rowHead}>
                  <View style={styles.rowMain}>
                    <Text style={styles.station} numberOfLines={1}>
                      {report.station?.name ?? 'Station'}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {report.fuel_type?.name ?? 'Fuel'} ·{' '}
                      {confirmationsLabel(report.confirmation_count)} ·{' '}
                      {formatDate(report.created_at)}
                    </Text>
                  </View>
                  <Text style={[styles.price, styles.pricePending]}>
                    {formatCurrency(report.reported_price)}
                    <Text style={styles.priceUnit}>/L</Text>
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm the price at ${report.station?.name ?? 'this station'}`}
                  disabled={confirmingId === report.id}
                  onPress={() => handleConfirm(report)}
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    pressed && styles.pressed,
                    confirmingId === report.id && styles.busy,
                  ]}>
                  <Text style={styles.confirmBtnText}>
                    {confirmingId === report.id ? 'Confirming…' : 'Price is accurate'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  busy: { opacity: 0.5 },
  // `xxl` is the deepest step in GasTaSpacing -- there is no `xxxl`. This
  // bottom padding clears the floating tab bar.
  padding: { padding: spacing.lg, paddingBottom: spacing.xxl },

  /* ---- header ---- */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: GasTaColors.textPrimary,
  },
  headerMeta: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textSoft,
    marginTop: 2,
  },
  headerAction: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.forest,
  },
  headerActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.textOnForest,
  },

  /* ---- sections ---- */
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
    marginBottom: spacing.sm,
  },
  sectionTitleTop: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: GasTaColors.textSoft,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },

  /* ---- rows ----
     Not every section is a white card. Verified data gets a pale forest cast;
     pending data gets a pale amber cast, so the two read apart at a glance
     without any extra text. */
  list: {
    backgroundColor: GasTaColors.creamLight,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    overflow: 'hidden',
  },
  verifiedList: {
    backgroundColor: 'rgba(46, 125, 50, 0.07)',
    borderColor: 'rgba(46, 125, 50, 0.26)',
  },
  pendingList: {
    backgroundColor: 'rgba(180, 83, 9, 0.07)',
    borderColor: 'rgba(180, 83, 9, 0.24)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowMain: { flex: 1, minWidth: 0 },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GasTaColors.forestGlow,
  },
  station: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    color: GasTaColors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  meta: {
    fontSize: 11,
    lineHeight: 15,
    color: GasTaColors.textSoft,
    marginTop: 1,
  },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: GasTaColors.forestGlow,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: GasTaColors.forestDark,
  },
  /* Pending stays amber so it never reads as a confirmed figure. */
  pricePending: { color: '#9A6700' },
  priceUnit: { fontSize: 10, fontWeight: '700', opacity: 0.7 },

  confirmBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forest,
    backgroundColor: GasTaColors.creamLight,
  },
  confirmBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },

  /* ---- quiet empty states ---- */
  emptyBox: { paddingVertical: spacing.sm },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: GasTaColors.textPrimary,
    marginBottom: 2,
  },
  emptyLine: {
    fontSize: 13,
    lineHeight: 19,
    color: GasTaColors.textSoft,
  },
});
