import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PageHero from '@/components/ui/PageHero';
import PrimaryButton from '@/components/ui/PrimaryButton';
import ProgressBar from '@/components/ui/ProgressBar';
import SectionHeader from '@/components/ui/SectionHeader';
import { moduleColors } from '@/constants/moduleColors';
import { palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, monthName } from '@/lib/format';
import {
  budgetAlertStatus,
  deleteBudget,
  fetchBudgetAnalytics,
  fetchBudgets,
  upsertBudget,
  type BudgetAnalytics,
} from '@/lib/services/budgets';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { FuelBudget } from '@/types';
import { Text } from '@/components/Themed';

interface BudgetWithSpend extends FuelBudget {
  spent: number;
  remaining: number;
  usagePercent: number;
  analytics: BudgetAnalytics;
  status: 'ok' | 'warning' | 'exceeded';
}

export default function BudgetScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
  const [budgets, setBudgets] = useState<BudgetWithSpend[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [limit, setLimit] = useState('5000');
  const [threshold, setThreshold] = useState('80');

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const list = await fetchBudgets(user.id);
      const enriched = await Promise.all(
        list.map(async (b) => {
          const analytics = await fetchBudgetAnalytics(user.id, b.year, b.month);
          const spent = analytics.spent;
          const remaining = b.limit_amount - spent;
          return {
            ...b,
            spent,
            remaining,
            usagePercent: b.limit_amount > 0 ? (spent / b.limit_amount) * 100 : 0,
            analytics,
            status: budgetAlertStatus(spent, b.limit_amount, b.alert_threshold_percent),
          };
        })
      );
      setBudgets(enriched);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load budgets');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!user) return;
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);
    const limitNum = parseFloat(limit);
    const thresholdNum = parseInt(threshold, 10);
    if (
      !Number.isInteger(yearNum) ||
      yearNum < 2020 ||
      yearNum > 2100 ||
      !Number.isInteger(monthNum) ||
      monthNum < 1 ||
      monthNum > 12 ||
      !Number.isFinite(limitNum) ||
      limitNum <= 0 ||
      !Number.isInteger(thresholdNum) ||
      thresholdNum < 1 ||
      thresholdNum > 100
    ) {
      Alert.alert(
        'Invalid input',
        'Enter a valid year, month, positive budget amount, and alert threshold from 1 to 100.'
      );
      return;
    }
    setSaving(true);
    try {
      await upsertBudget({
        userId: user.id,
        year: yearNum,
        month: monthNum,
        limitAmount: limitNum,
        alertThresholdPercent: thresholdNum,
      });
      await load();
      Alert.alert('Saved', 'Fuel budget updated.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save budget');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (budgetId: string) => {
    Alert.alert('Delete budget', 'Remove this monthly budget?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (!user) return;
            await deleteBudget(budgetId, user.id);
            await load();
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete budget');
          }
        },
      },
    ]);
  };

  const statusConfig = (status: BudgetWithSpend['status']) => {
    if (status === 'exceeded') {
      return { label: 'Over budget', color: palette.danger, bg: palette.dangerSoft };
    }
    if (status === 'warning') {
      return { label: 'Nearing limit', color: palette.warning, bg: palette.warningSoft };
    }
    return { label: 'On track', color: palette.success, bg: palette.successSoft };
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to set monthly fuel budgets and track spending alerts."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <PageHero
        module="budget"
        title="Fuel Budget"
        subtitle="Plan your fuel spending and stay aware of your monthly limit."
      >
        <View style={[styles.heroPanel, { backgroundColor: moduleColors.budget.main }]}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>PERSONAL PLANNER</Text>
            <Text style={styles.heroHeadline}>
              {budgets.length === 0
                ? 'Set a limit for your fuel spend'
                : `${budgets.length} active ${budgets.length === 1 ? 'budget' : 'budgets'}`}
            </Text>
            <Text style={styles.heroDescription}>
              Spending is calculated from your logged own-vehicle trips.
            </Text>
          </View>
          <View style={styles.heroCount}>
            <Text style={styles.heroCountValue}>{budgets.length}</Text>
            <Text style={styles.heroCountLabel}>ACTIVE</Text>
          </View>
        </View>
      </PageHero>

      <FormSection
        title="Set a budget"
        subtitle="Choose a month, spending limit, and warning point"
        module="budget">
        <Text style={[styles.formGroupLabel, { color: theme.textSecondary }]}>Budget period</Text>
        <View style={styles.rowInputs}>
          <View style={styles.halfInput}>
            <LabeledInput label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" />
          </View>
          <View style={styles.halfInput}>
            <LabeledInput label="Month" value={month} onChangeText={setMonth} keyboardType="number-pad" />
          </View>
        </View>
        <Text style={[styles.formGroupLabel, { color: theme.textSecondary }]}>Spending controls</Text>
        <LabeledInput
          label="Monthly limit (₱)"
          value={limit}
          onChangeText={setLimit}
          keyboardType="decimal-pad"
        />
        <LabeledInput
          label="Alert at (%)"
          value={threshold}
          onChangeText={setThreshold}
          keyboardType="number-pad"
        />
        <Text style={[styles.formHint, { color: theme.textSecondary }]}>
          We’ll compare this limit with fuel costs from your trip history.
        </Text>
        <PrimaryButton
          label={saving ? 'Saving…' : 'Save budget'}
          onPress={handleSave}
          disabled={saving}
        />
      </FormSection>

      <SectionHeader title="Your budgets" subtitle={`${budgets.length} active`} module="budget" />
      {budgets.length === 0 ? (
        <EmptyState
          title="No budgets yet"
          message="Create a monthly limit above to start tracking fuel spending."
        />
      ) : (
        budgets.map((b) => {
          const progress = b.limit_amount > 0 ? Math.min(b.spent / b.limit_amount, 1) : 0;
          const status = statusConfig(b.status);

          return (
            <Card key={b.id} elevated style={styles.budgetCard}>
              <View style={styles.budgetHeader}>
                <View style={styles.budgetTitleBlock}>
                  <Text style={[styles.cardEyebrow, { color: theme.textSecondary }]}>MONTHLY BUDGET</Text>
                  <Text style={[styles.budgetTitle, { color: theme.text }]}>
                    {monthName(b.month)} {b.year}
                  </Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                  <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                </View>
              </View>
              <View style={styles.metricRow}>
                <View style={[styles.metricCard, { backgroundColor: theme.overlay }]}>
                  <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Spent</Text>
                  <Text style={[styles.metricValue, { color: theme.text }]}>
                    {formatCurrency(b.spent)}
                  </Text>
                </View>
                <View style={[styles.metricCard, { backgroundColor: theme.overlay }]}>
                  <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Limit</Text>
                  <Text style={[styles.metricValue, { color: theme.text }]}>
                    {formatCurrency(b.limit_amount)}
                  </Text>
                </View>
              </View>
              <ProgressBar progress={progress} color={status.color} trackColor={theme.borderLight} />
              <View style={styles.summaryRow}>
                <View>
                  <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>Remaining</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      { color: b.remaining < 0 ? palette.danger : theme.text },
                    ]}>
                    {formatCurrency(Math.abs(b.remaining))}
                    {b.remaining < 0 ? ' over' : ''}
                  </Text>
                </View>
                <View style={styles.summaryRight}>
                  <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>Used</Text>
                  <Text style={[styles.summaryValue, { color: theme.text }]}>
                    {Math.round(b.usagePercent)}%
                  </Text>
                </View>
              </View>
              <Text style={[styles.progressMeta, { color: theme.textSecondary }]}>
                Alert at {b.alert_threshold_percent}% · based on own-vehicle trip costs
              </Text>
              <View style={[styles.insightsBox, { backgroundColor: theme.overlay }]}>
                <Text style={[styles.insightsTitle, { color: theme.text }]}>Budget insights</Text>
                <Text style={[styles.insightText, { color: theme.textSecondary }]}>
                  {b.status === 'exceeded'
                    ? `You have exceeded this budget by ${formatCurrency(Math.abs(b.remaining))}.`
                    : b.status === 'warning'
                      ? `You have used ${Math.round(b.usagePercent)}% of this budget and are approaching the limit.`
                      : `You have used ${Math.round(b.usagePercent)}% of this budget.`}
                </Text>
                {b.analytics.trendPercent !== null ? (
                  <Text style={[styles.insightText, { color: theme.textSecondary }]}>
                    Fuel spending is {Math.abs(b.analytics.trendPercent).toFixed(1)}%{' '}
                    {b.analytics.trendPercent >= 0 ? 'higher' : 'lower'} than the previous month.
                  </Text>
                ) : (
                  <Text style={[styles.insightText, { color: theme.textSecondary }]}>
                    More trip history is needed to show a spending trend.
                  </Text>
                )}
                {b.analytics.highCostTripCount > 0 ? (
                  <Text style={[styles.insightText, { color: theme.textSecondary }]}>
                    Some recent trips have fuel costs above your usual trip average.
                  </Text>
                ) : b.analytics.tripCount === 0 ? (
                  <Text style={[styles.insightText, { color: theme.textSecondary }]}>
                    Add logged trips to identify higher-cost spending patterns.
                  </Text>
                ) : null}
                {b.analytics.projectedSpent !== null &&
                b.analytics.projectedSpent > b.limit_amount ? (
                  <Text style={[styles.insightText, { color: palette.warning }]}>
                    At your current spending rate, you may exceed this budget.
                  </Text>
                ) : null}
              </View>
              <PrimaryButton
                label="Delete"
                variant="danger"
                size="sm"
                onPress={() => handleDelete(b.id)}
                style={styles.deleteBtn}
              />
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heroPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  heroCopy: { flex: 1, paddingRight: spacing.md },
  heroEyebrow: {
    color: 'rgba(248, 240, 229, 0.72)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  heroHeadline: {
    color: '#F8F0E5',
    fontSize: 19,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  heroDescription: {
    color: 'rgba(248, 240, 229, 0.82)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  heroCount: {
    width: 68,
    height: 68,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 240, 229, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(248, 240, 229, 0.28)',
  },
  heroCountValue: { color: '#F8F0E5', fontSize: 26, fontWeight: '800' },
  heroCountLabel: {
    color: 'rgba(248, 240, 229, 0.76)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: -2,
  },
  formGroupLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  formHint: { fontSize: 12, lineHeight: 17, marginTop: -spacing.sm, marginBottom: spacing.md },
  rowInputs: { flexDirection: 'row', gap: spacing.sm },
  halfInput: { flex: 1 },
  budgetCard: { padding: spacing.md },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  budgetTitleBlock: { flex: 1 },
  cardEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 3 },
  budgetTitle: { fontSize: 18, fontWeight: '800' },
  statusPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  statusText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  metricRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  metricCard: { flex: 1, borderRadius: radii.sm, padding: spacing.sm },
  metricLabel: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  metricValue: { fontSize: 16, fontWeight: '800' },
  progressMeta: { fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.md },
  insightsBox: { borderRadius: radii.sm, padding: spacing.md, marginBottom: spacing.md },
  insightsTitle: { fontSize: 14, fontWeight: '800', marginBottom: spacing.xs },
  insightText: { fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  summaryRight: { alignItems: 'flex-end' },
  summaryLabel: { fontSize: 12, fontWeight: '600' },
  summaryValue: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  deleteBtn: { alignSelf: 'flex-start' },
});
