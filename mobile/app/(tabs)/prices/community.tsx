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
  canDeleteCommunityReport,
  confirmationsLabel,
  confirmCommunityReport,
  deleteCommunityReport,
  fetchFreshVerifiedPrices,
  fetchMyCommunityReports,
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
  // Own reports, kept separate from the shared lists so withdrawing one never
  // mutates verified/pending state that other users also depend on.
  const [mine, setMine] = useState<PendingCommunityReport[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [v, p, own] = await Promise.all([
        fetchFreshVerifiedPrices(),
        fetchPendingReports(),
        user ? fetchMyCommunityReports(user.id).catch(() => []) : Promise.resolve([]),
      ]);
      setVerified(v);
      setPending(p);
      setMine(own);
    } catch (e) {
      console.warn('Community prices load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      // Reset state and reload to ensure fresh data from database
      setVerified([]);
      setPending([]);
      setMine([]);
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

  const handleDelete = (report: PendingCommunityReport) => {
    // Guard before the dialog too: a second tap while a delete is in flight
    // must not open a second dialog for the same row.
    if (deletingId) return;

    Alert.alert(
      'Delete price report?',
      `This will remove your reported price of ${formatCurrency(report.reported_price)} for ${
        report.station?.name ?? 'this station'
      }.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void runDelete(report);
          },
        },
      ]
    );
  };

  const runDelete = async (report: PendingCommunityReport) => {
    setDeletingId(report.id);
    setDeleteError(null);
    try {
      await deleteCommunityReport(report.id);
      // Drop it locally so the row disappears immediately, then refetch so the
      // shared lists settle to whatever the database now says.
      setMine((prev) => prev.filter((r) => r.id !== report.id));
      Alert.alert('Report deleted', 'Your reported price was removed.');
      await load();
    } catch (e) {
      // A normal failed withdrawal is not a full-screen error. The row stays put
      // and an inline message explains it.
      setDeleteError(e instanceof Error ? e.message : 'Could not delete this report.');
    } finally {
      setDeletingId(null);
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

      {/* Own reports live in their own compact block above the shared lists, so
          withdrawal is contextual and the main lists stay uncluttered. */}
      {user ? (
        <>
          <Text style={styles.sectionTitleTop}>My reports</Text>
          {deleteError ? (
            <View style={styles.inlineError}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={14}
                color={GasTaColors.error}
              />
              <Text style={styles.inlineErrorText}>{deleteError}</Text>
            </View>
          ) : null}
          {mine.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>You haven&apos;t reported a price yet</Text>
              <Text style={styles.emptyLine}>
                Reports you submit appear here so you can withdraw them.
              </Text>
            </View>
          ) : (
            <View style={[styles.list, styles.ownList]}>
              {mine.map((report, index) => {
                const canDelete = canDeleteCommunityReport(report.status);
                const busy = deletingId === report.id;
                return (
                  <View
                    key={report.id}
                    style={[
                      styles.row,
                      styles.rowStacked,
                      index < mine.length - 1 && styles.divider,
                    ]}>
                    <View style={styles.rowHead}>
                      <View style={styles.rowMain}>
                        <View style={styles.ownTitleRow}>
                          <Text style={styles.station} numberOfLines={1}>
                            {report.station?.name ?? 'Station'}
                          </Text>
                          <View style={styles.yoursPill}>
                            <Text style={styles.yoursPillText}>Your report</Text>
                          </View>
                        </View>
                        <Text style={styles.meta} numberOfLines={1}>
                          {report.fuel_type?.name ?? 'Fuel'} ·{' '}
                          {confirmationsLabel(report.confirmation_count)} ·{' '}
                          {formatDate(report.created_at)}
                        </Text>
                      </View>
                      <View style={styles.ownPriceCol}>
                        <Text style={[styles.price, canDelete && styles.pricePending]}>
                          {formatCurrency(report.reported_price)}
                          <Text style={styles.priceUnit}>/L</Text>
                        </Text>
                        <Text
                          style={[
                            styles.ownStatus,
                            canDelete ? styles.ownStatusPending : styles.ownStatusVerified,
                          ]}>
                          {canDelete ? 'Pending' : 'Verified'}
                        </Text>
                      </View>
                    </View>
                    {canDelete ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete your ${formatCurrency(
                          report.reported_price
                        )} report at ${report.station?.name ?? 'this station'}`}
                        accessibilityState={{ disabled: busy }}
                        hitSlop={8}
                        disabled={busy || deletingId !== null}
                        onPress={() => handleDelete(report)}
                        style={({ pressed }) => [
                          styles.deleteBtn,
                          pressed && styles.pressed,
                          busy && styles.busy,
                        ]}>
                        <MaterialCommunityIcons
                          name="trash-can-outline"
                          size={13}
                          color={GasTaColors.error}
                        />
                        <Text style={styles.deleteBtnText}>
                          {busy ? 'Deleting…' : 'Delete'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.ownLockedNote}>
                        Verified reports can&apos;t be withdrawn — other drivers rely on them.
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : null}

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
  ownList: {
    backgroundColor: GasTaColors.creamLight,
    borderColor: GasTaColors.forestBorder,
  },
  ownTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  yoursPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: GasTaColors.forestGlow,
  },
  yoursPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: GasTaColors.forest,
  },
  ownPriceCol: { alignItems: 'flex-end' },
  ownStatus: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  ownStatusPending: { color: 'rgba(180, 83, 9, 1)' },
  ownStatusVerified: { color: GasTaColors.forest },
  /* Restrained, contextual action -- not a full-width red button. */
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.24)',
    backgroundColor: 'rgba(220, 38, 38, 0.10)',
  },
  deleteBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: GasTaColors.error,
  },
  ownLockedNote: {
    fontSize: 11,
    lineHeight: 16,
    color: GasTaColors.textSoft,
    marginTop: spacing.sm,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.24)',
    backgroundColor: 'rgba(220, 38, 38, 0.10)',
  },
  inlineErrorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: GasTaColors.error,
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
