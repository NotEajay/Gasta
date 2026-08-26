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
import { palette, radii, spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { formatCurrency, monthName } from '@/lib/format';
import {
  budgetAlertStatus,
  deleteBudget,
  estimateMonthlyFuelSpend,
  fetchBudgets,
  upsertBudget,
} from '@/lib/services/budgets';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { FuelBudget } from '@/types';
import { Text } from '@/components/Themed';

interface BudgetWithSpend extends FuelBudget {
  spent: number;
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
          const spent = await estimateMonthlyFuelSpend(user.id, b.year, b.month);
          return {
            ...b,
            spent,
            status: budgetAlertStatus(spent, b.limit_amount, b.alert_threshold_percent),
          };
        })
      );
      setBudgets(enriched);
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
    if (!yearNum || !monthNum || !limitNum || !thresholdNum) {
      Alert.alert('Invalid input', 'Check year, month, limit, and threshold.');
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
          await deleteBudget(budgetId);
          await load();
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
        subtitle="Track monthly fuel spend from logged trip history."
      />

      <FormSection title="New budget" subtitle="Set limit and alert threshold" module="budget">
        <View style={styles.rowInputs}>
          <View style={styles.halfInput}>
            <LabeledInput label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" />
          </View>
          <View style={styles.halfInput}>
            <LabeledInput label="Month" value={month} onChangeText={setMonth} keyboardType="number-pad" />
          </View>
        </View>
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
            <Card key={b.id} elevated>
              <View style={styles.budgetHeader}>
                <Text style={[styles.budgetTitle, { color: theme.text }]}>
                  {monthName(b.month)} {b.year}
                </Text>
                <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                  <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                </View>
              </View>
              <Text style={[styles.amountRow, { color: theme.text }]}>
                {formatCurrency(b.spent)}
                <Text style={[styles.amountLimit, { color: theme.textSecondary }]}>
                  {' '}
                  / {formatCurrency(b.limit_amount)}
                </Text>
              </Text>
              <ProgressBar progress={progress} color={status.color} trackColor={theme.borderLight} />
              <Text style={[styles.progressMeta, { color: theme.textSecondary }]}>
                {Math.round(progress * 100)}% used · alert at {b.alert_threshold_percent}%
              </Text>
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
  padding: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  rowInputs: { flexDirection: 'row', gap: spacing.sm },
  halfInput: { flex: 1 },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  budgetTitle: { fontSize: 18, fontWeight: '800' },
  statusPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  statusText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  amountRow: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: spacing.md },
  amountLimit: { fontSize: 16, fontWeight: '600' },
  progressMeta: { fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.md },
  deleteBtn: { alignSelf: 'flex-start' },
});
