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

export interface BudgetAnalytics {
  spent: number;
  previousSpent: number;
  tripCount: number;
  highCostTripCount: number;
  trendPercent: number | null;
  projectedSpent: number | null;
}

interface FuelSpendTripRow {
  mode_evaluations: unknown;
  created_at: string;
}

function ownVehicleFuelCost(row: FuelSpendTripRow): number {
  if (!Array.isArray(row.mode_evaluations)) return 0;
  const own = row.mode_evaluations.find(
    (evaluation): evaluation is { modeCode: string; raw?: { fuelCost?: number } } =>
      typeof evaluation === 'object' &&
      evaluation !== null &&
      'modeCode' in evaluation &&
      evaluation.modeCode === 'OWN_VEHICLE'
  );
  const fuelCost = own?.raw?.fuelCost;
  return typeof fuelCost === 'number' && Number.isFinite(fuelCost) && fuelCost > 0 ? fuelCost : 0;
}

function monthBounds(year: number, month: number) {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  };
}

export async function fetchBudgetAnalytics(
  userId: string,
  year: number,
  month: number
): Promise<BudgetAnalytics> {
  const current = monthBounds(year, month);
  const previous = monthBounds(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
  const { data, error } = await supabase
    .from('trip_records')
    .select('mode_evaluations, created_at')
    .eq('user_id', userId)
    .gte('created_at', previous.start.toISOString())
    .lt('created_at', current.end.toISOString());

  if (error) throw error;

  const currentTrips = ((data ?? []) as FuelSpendTripRow[]).filter((trip) => {
    const createdAt = new Date(trip.created_at).getTime();
    return createdAt >= current.start.getTime() && createdAt < current.end.getTime();
  });
  const previousTrips = ((data ?? []) as FuelSpendTripRow[]).filter((trip) => {
    const createdAt = new Date(trip.created_at).getTime();
    return createdAt >= previous.start.getTime() && createdAt < previous.end.getTime();
  });
  const currentCosts = currentTrips.map(ownVehicleFuelCost).filter((cost) => cost > 0);
  const previousSpent = previousTrips.reduce((sum, trip) => sum + ownVehicleFuelCost(trip), 0);
  const spent = currentCosts.reduce((sum, cost) => sum + cost, 0);
  const averageCost = currentCosts.length > 0 ? spent / currentCosts.length : 0;
  const highCostTripCount =
    averageCost > 0 ? currentCosts.filter((cost) => cost > averageCost).length : 0;
  const trendPercent =
    previousSpent > 0 ? ((spent - previousSpent) / previousSpent) * 100 : null;
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const elapsedDays = now.getDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const projectedSpent =
    isCurrentMonth && elapsedDays > 0 && spent > 0
      ? (spent / elapsedDays) * daysInMonth
      : null;

  return {
    spent,
    previousSpent,
    tripCount: currentCosts.length,
    highCostTripCount,
    trendPercent,
    projectedSpent,
  };
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

export async function deleteBudget(budgetId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('fuel_budgets')
    .delete()
    .eq('id', budgetId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Estimate spent amount from trip history (trip_records) in the same month — own-vehicle fuel cost only. */
export async function estimateMonthlyFuelSpend(
  userId: string,
  year: number,
  month: number
): Promise<number> {
  const analytics = await fetchBudgetAnalytics(userId, year, month);
  return analytics.spent;
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
