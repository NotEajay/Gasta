import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import { Text } from '@/components/Themed';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatPeso } from '@/lib/format';
import {
  ActualSpendUnavailableError,
  deleteBudget,
  fetchMonthBudgetSummaries,
  getMonthlyBudgetOverview,
  upsertBudget,
  type BudgetStatus,
  type MonthBudgetSummary,
  type MonthlyBudgetOverview,
} from '@/lib/services/budgets';
import { fetchMyPendingAllocations } from '@/lib/services/refillAllocations';
import { isSupabaseConfigured } from '@/lib/supabase';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function shiftMonth(year: number, month: number, delta: number) {
  const zeroBased = month - 1 + delta;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  };
}

const STATUS_META: Record<BudgetStatus, { label: string; color: string }> = {
  unset: { label: 'No budget set', color: HomeColors.muted },
  ok: { label: 'On track', color: HomeColors.primary },
  warning: { label: 'Near limit', color: palette.warning },
  exceeded: { label: 'Over budget', color: palette.danger },
};

export default function BudgetScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [overview, setOverview] = useState<MonthlyBudgetOverview | null>(null);
  const [months, setMonths] = useState<MonthBudgetSummary[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState('5000');
  const [threshold, setThreshold] = useState('80');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!user || !isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);

      try {
        const [next, list, pending] = await Promise.all([
          getMonthlyBudgetOverview(user.id, year, month),
          // Non-fatal: the other-months list is a convenience, not the main view.
          fetchMonthBudgetSummaries(user.id, year, month).catch(() => []),
          fetchMyPendingAllocations().catch(() => []),
        ]);

        setOverview(next);
        setMonths(list);
        setPendingCount(pending.length);
        setPendingTotal(pending.reduce((sum, p) => sum + Number(p.amount), 0));
        setLimit(String(next.budget?.limit_amount ?? ''));
        setThreshold(String(next.budget?.alert_threshold_percent ?? 80));
        setError(null);
      } catch (e) {
        // A missing Phase 2 RPC must neither blank the page nor be reported as
        // a real zero, so this is surfaced rather than swallowed.
        setError(
          e instanceof ActualSpendUnavailableError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Unable to load your budget.'
        );
        setOverview(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user, year, month]
  );

  // Reloads every time the tab is focused, so accepting or rejecting an
  // allocation on the Vehicles screen shows up here immediately.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleSave = async () => {
    if (!user) return;
    const limitNum = Number.parseFloat(limit);
    const thresholdNum = Number.parseInt(threshold, 10);
    if (!Number.isFinite(limitNum) || limitNum <= 0) {
      Alert.alert('Invalid input', 'Enter a monthly limit greater than zero.');
      return;
    }
    if (!Number.isFinite(thresholdNum) || thresholdNum < 1 || thresholdNum > 100) {
      Alert.alert('Invalid input', 'Alert threshold must be between 1 and 100.');
      return;
    }
    setSaving(true);
    try {
      await upsertBudget({
        userId: user.id,
        year,
        month,
        limitAmount: limitNum,
        alertThresholdPercent: thresholdNum,
      });
      await load('refresh');
      Alert.alert('Saved', `Fuel budget for ${MONTHS[month - 1]} ${year} updated.`);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    const target = overview?.budget;
    if (!target) return;
    Alert.alert('Remove budget', `Remove the ${MONTHS[month - 1]} ${year} budget?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBudget(target.id);
            await load('refresh');
          } catch (e) {
            Alert.alert('Could not remove', e instanceof Error ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  };

  const spent = overview?.actualRefillSpend ?? 0;
  const limitAmount = overview?.limitAmount ?? 0;
  const hasBudget = Boolean(overview?.budget);
  const statusMeta = STATUS_META[overview?.status ?? 'unset'];
  const percent = overview ? Math.round(overview.progress * 100) : 0;
  // Never rendered as a negative "remaining": the label switches to "Over budget".
  const isOver = (overview?.overBy ?? 0) > 0;
  const headroom = isOver ? (overview?.overBy ?? 0) : (overview?.remaining ?? 0);


  if (!authLoading && !user) {
    return (
      <AuthPrompt
        message="Sign in to set and track your personal fuel budget."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={tabBarScrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={HomeColors.primary}
          />
        }>
        {!isSupabaseConfigured ? <SupabaseSetupBanner /> : null}

        {/* ------------------------------------------------ header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Budget</Text>
          <Text style={styles.headerSubtitle}>
            {MONTHS[month - 1]} {year}
          </Text>
        </View>

        <View style={styles.monthNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            hitSlop={8}
            style={styles.monthBtn}
            onPress={() => {
              const next = shiftMonth(year, month, -1);
              setYear(next.year);
              setMonth(next.month);
            }}>
            <Ionicons name="chevron-back" size={18} color={HomeColors.muted} />
          </Pressable>
          <Text style={styles.monthLabel}>
            {MONTHS[month - 1]} {year}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            hitSlop={8}
            style={styles.monthBtn}
            onPress={() => {
              const next = shiftMonth(year, month, 1);
              setYear(next.year);
              setMonth(next.month);
            }}>
            <Ionicons name="chevron-forward" size={18} color={HomeColors.muted} />
          </Pressable>
        </View>

        {loading ? (
          <LoadingState />
        ) : (
          <>
            {/* ------------------------------- primary budget block */}
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Monthly fuel budget</Text>
              {hasBudget ? (
                <Text style={styles.limitAmount}>{formatPeso(limitAmount)}</Text>
              ) : (
                <Text style={styles.limitAmountMuted}>Not set</Text>
              )}

              {error ? (
                <>
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                  <PrimaryButton
                    label="Retry"
                    variant="secondary"
                    size="sm"
                    onPress={() => load('refresh')}
                    style={styles.retryBtn}
                  />
                </>
              ) : hasBudget ? (
                <>
                  <View style={styles.spentRow}>
                    <Text style={styles.spentLabel}>Spent</Text>
                    <Text style={styles.spentValue}>{formatPeso(spent)}</Text>
                  </View>
                  <View style={styles.spentRow}>
                    <Text style={styles.spentLabel}>
                      {isOver ? 'Over budget' : 'Remaining'}
                    </Text>
                    <Text
                      style={[
                        styles.spentValue,
                        { color: isOver ? palette.danger : HomeColors.navy },
                      ]}>
                      {formatPeso(headroom)}
                    </Text>
                  </View>

                  <View style={styles.track}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${percent}%`, backgroundColor: statusMeta.color },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressMeta}>
                    {percent}% of budget used · alert at {overview?.thresholdPercent}%
                  </Text>
                </>
              ) : null}
            </View>

            {/* ------------------------------------ actual spending */}
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Actual refill spending</Text>
              <Text style={styles.metricValue}>
                {error ? '—' : formatPeso(spent)}
              </Text>
              <Text style={styles.blockHint}>
                Accepted portions of vehicle refills assigned to you. Only amounts you accepted
                count here.
              </Text>
            </View>

            {/* ---------------------------- estimated (secondary) */}
            <View style={styles.block}>
              <Text style={styles.blockLabel}>Estimated trip fuel cost</Text>
              <Text style={styles.metricSecondary}>
                {formatPeso(overview?.estimatedTripFuelCost ?? 0)}
              </Text>
              <Text style={styles.blockHint}>
                Based on your recorded trip estimates. This is separate from actual refill
                spending and is not added to it.
              </Text>
            </View>


            {/* ---------------------------------- status + pending */}
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
              <Text style={[styles.statusText, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
            </View>

            {pendingCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/vehicles')}
                style={styles.pendingRow}>
                <View style={styles.pendingInfo}>
                  <Text style={styles.pendingTitle}>
                    {formatPeso(pendingTotal)} awaiting your response
                  </Text>
                  <Text style={styles.blockHint}>
                    {pendingCount === 1
                      ? '1 refill request is not counted until you accept it.'
                      : `${pendingCount} refill requests are not counted until you accept them.`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={HomeColors.muted} />
              </Pressable>
            ) : null}

            <View style={styles.divider} />

            {/* --------------------------------------- budget editor */}
            <Text style={styles.sectionTitle}>
              {hasBudget ? 'Edit this budget' : 'Set a monthly fuel budget'}
            </Text>
            <Text style={styles.blockHint}>
              {hasBudget
                ? 'Change the limit or the alert point for this month.'
                : 'Track how much of your own fuel spending this month should stay under.'}
            </Text>

            <View style={styles.formRow}>
              <View style={styles.formHalf}>
                <LabeledInput
                  label="Monthly limit (₱)"
                  value={limit}
                  onChangeText={setLimit}
                  placeholder="5000"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.formHalf}>
                <LabeledInput
                  label="Alert at (%)"
                  value={threshold}
                  onChangeText={setThreshold}
                  placeholder="80"
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <PrimaryButton
              label={saving ? 'Saving…' : 'Save budget'}
              onPress={handleSave}
              disabled={saving}
              style={styles.saveBtn}
            />
            {hasBudget ? (
              <Pressable
                accessibilityRole="button"
                onPress={handleDelete}
                style={styles.removeBtn}>
                <Text style={styles.removeText}>Remove this budget</Text>
              </Pressable>
            ) : null}

            {/* ----------------------------------- other months list */}
            {months.length > 1 ? (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>Your other months</Text>
                {months
                  .filter((m) => !(m.year === year && m.month === month))
                  .map((m) => {
                    const meta = STATUS_META[m.status];
                    return (
                      <Pressable
                        key={`${m.year}-${m.month}`}
                        accessibilityRole="button"
                        onPress={() => {
                          setYear(m.year);
                          setMonth(m.month);
                        }}
                        style={styles.monthRow}>
                        <Text style={styles.monthRowTitle}>
                          {MONTHS[m.month - 1]} {m.year}
                        </Text>
                        <Text style={[styles.monthRowValue, { color: meta.color }]}>
                          {formatPeso(m.actualRefillSpend)} / {formatPeso(m.limitAmount)}
                        </Text>
                      </Pressable>
                    );
                  })}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: HomeColors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  header: { marginBottom: spacing.md },
  headerTitle: {
    color: HomeColors.navy,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    color: HomeColors.muted,
    fontSize: 14,
    marginTop: 2,
  },

  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  monthBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
  },
  monthLabel: {
    color: HomeColors.navy,
    fontSize: 15,
    fontWeight: '700',
  },

  /* Flat surface with a hairline, not a shadowed card. */
  block: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  blockLabel: {
    color: HomeColors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  blockHint: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  limitAmount: {
    color: HomeColors.navy,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: spacing.xs,
  },
  limitAmountMuted: {
    color: HomeColors.muted,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  spentRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  spentLabel: { color: HomeColors.muted, fontSize: 13 },
  spentValue: { color: HomeColors.navy, fontSize: 15, fontWeight: '700' },

  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: HomeColors.navySoft,
    marginTop: spacing.lg,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: radii.pill },
  progressMeta: {
    color: HomeColors.muted,
    fontSize: 12,
    marginTop: spacing.sm,
  },

  metricValue: {
    color: HomeColors.primary,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  metricSecondary: {
    color: HomeColors.muted,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    marginTop: spacing.xs,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '700' },

  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
    marginBottom: spacing.md,
  },
  pendingInfo: { flex: 1 },
  pendingTitle: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '700',
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: palette.dangerSoft,
  },
  errorText: { flex: 1, color: palette.danger, fontSize: 12, lineHeight: 17 },
  retryBtn: { alignSelf: 'flex-start', marginTop: spacing.sm },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HomeColors.border,
    marginVertical: spacing.lg,
  },
  sectionTitle: {
    color: HomeColors.navy,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },

  formRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  formHalf: { flex: 1 },
  saveBtn: { marginTop: spacing.md },
  removeBtn: { alignSelf: 'flex-start', marginTop: spacing.md, paddingVertical: spacing.xs },
  removeText: { color: palette.danger, fontSize: 13, fontWeight: '700' },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HomeColors.border,
  },
  monthRowTitle: { color: HomeColors.navy, fontSize: 14, fontWeight: '600' },
  monthRowValue: { fontSize: 13, fontWeight: '700' },
});
