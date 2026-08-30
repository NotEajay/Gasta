import { supabase } from '@/lib/supabase';
import type { FuelBudget } from '@/types';

export async function fetchBudgets(userId: string): Promise<FuelBudget[]> {
  const { data, error } = await supabase
    .from('fuel_budgets')
    .select('*')
    .eq('user_id', userId)
    .order('year', { ascending: false })
    .order('month', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export interface UpsertBudgetInput {
  userId: string;
  year: number;
  month: number;
  limitAmount: number;
  alertThresholdPercent: number;
}

export async function upsertBudget(input: UpsertBudgetInput): Promise<FuelBudget> {
  const { data, error } = await supabase
    .from('fuel_budgets')
    .upsert(
      {
        user_id: input.userId,
        year: input.year,
        month: input.month,
        limit_amount: input.limitAmount,
        alert_threshold_percent: input.alertThresholdPercent,
      },
      { onConflict: 'user_id,year,month' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteBudget(budgetId: string): Promise<void> {
  const { error } = await supabase.from('fuel_budgets').delete().eq('id', budgetId);
  if (error) throw error;
}

/** Estimate spent amount from trip history (trip_records) in the same month — own-vehicle fuel cost only. */
export async function estimateMonthlyFuelSpend(
  userId: string,
  year: number,
  month: number
): Promise<number> {
  const start = new Date(year, month - 1, 1).toISOString();
  const end = new Date(year, month, 1).toISOString();

  const { data, error } = await supabase
    .from('trip_records')
    .select('mode_evaluations, recommended_mode_code, created_at')
    .eq('user_id', userId)
    .gte('created_at', start)
    .lt('created_at', end);

  if (error) throw error;

  return (data ?? []).reduce((sum, trip) => {
    const evaluations = trip.mode_evaluations as {
      modeCode: string;
      raw: { fuelCost: number };
    }[];
    const own = evaluations.find((e) => e.modeCode === 'OWN_VEHICLE');
    return sum + (own?.raw.fuelCost ?? 0);
  }, 0);
}

export function budgetAlertStatus(
  spent: number,
  limit: number,
  thresholdPercent: number
): 'ok' | 'warning' | 'exceeded' {
  if (spent >= limit) return 'exceeded';
  if (spent >= limit * (thresholdPercent / 100)) return 'warning';
  return 'ok';
}
