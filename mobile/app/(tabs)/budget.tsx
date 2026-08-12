import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
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
import type { FuelBudget } from '@/types';

interface BudgetWithSpend extends FuelBudget {
  spent: number;
  status: 'ok' | 'warning' | 'exceeded';
}

export default function BudgetScreen() {
  const router = useRouter();
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

  const statusLabel = (status: BudgetWithSpend['status']) => {
    if (status === 'exceeded') return 'Budget exceeded';
    if (status === 'warning') return 'Approaching limit';
    return 'Within budget';
  };

  const statusColor = (status: BudgetWithSpend['status']) => {
    if (status === 'exceeded') return '#c0392b';
    if (status === 'warning') return '#d68910';
    return '#1a7f37';
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
    <ScrollView style={styles.flex} contentContainerStyle={styles.padding}>
      <Text style={styles.heading}>Fuel Budget Planner</Text>
      <Text style={styles.subheading}>
        Spending is estimated from saved trip records (own-vehicle fuel cost).
      </Text>

      <Text style={styles.sectionTitle}>Set monthly budget</Text>
      <LabeledInput label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" />
      <LabeledInput label="Month (1–12)" value={month} onChangeText={setMonth} keyboardType="number-pad" />
      <LabeledInput
        label="Monthly limit (₱)"
        value={limit}
        onChangeText={setLimit}
        keyboardType="decimal-pad"
      />
      <LabeledInput
        label="Alert threshold (%)"
        value={threshold}
        onChangeText={setThreshold}
        keyboardType="number-pad"
      />
      <PrimaryButton
        label={saving ? 'Saving…' : 'Save budget'}
        onPress={handleSave}
        disabled={saving}
      />

      <Text style={styles.sectionTitle}>Your budgets</Text>
      {budgets.length === 0 ? (
        <Card>
          <Text>No budgets yet. Create one above.</Text>
        </Card>
      ) : (
        budgets.map((b) => (
          <Card key={b.id}>
            <Text style={styles.budgetTitle}>
              {monthName(b.month)} {b.year}
            </Text>
            <Text>
              Spent: {formatCurrency(b.spent)} / {formatCurrency(b.limit_amount)}
            </Text>
            <Text style={[styles.status, { color: statusColor(b.status) }]}>
              {statusLabel(b.status)} (alert at {b.alert_threshold_percent}%)
            </Text>
            <PrimaryButton
              label="Delete"
              variant="danger"
              onPress={() => handleDelete(b.id)}
              style={styles.deleteBtn}
            />
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: 16, paddingBottom: 32 },
  heading: { fontSize: 22, fontWeight: 'bold' },
  subheading: { opacity: 0.7, marginBottom: 16, lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginVertical: 12 },
  budgetTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  status: { marginTop: 6, fontWeight: '600' },
  deleteBtn: { marginTop: 12 },
});
