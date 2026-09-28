import { supabase } from '@/lib/supabase';
import { fetchMyAcceptedRefillTotal } from '@/lib/services/refillAllocations';
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

/* ------------------------------------------------------------------ *
 * Personal fuel budget overview
 *
 * Two independent measurements of fuel cost, deliberately never added:
 *
 *   actualRefillSpend      money a person actually carries, from the accepted
 *                           portions of shared vehicle refills. This is the
 *                           PRIMARY budget figure.
 *   estimatedTripFuelCost   what trip history implies the month would cost.
 *                           An estimate, kept as an informational metric only.
 *
 * Summing them would double count, because the trips and the refills usually
 * describe the same journeys.
 * ------------------------------------------------------------------ */

export type BudgetStatus = 'unset' | 'ok' | 'warning' | 'exceeded';

export interface MonthlyBudgetOverview {
  /** The user's budget row for this month, or null when none is set. */
  budget: FuelBudget | null;
  limitAmount: number;
  thresholdPercent: number;
  /** Accepted refill allocations for this user, refills not voided. */
  actualRefillSpend: number;
  /** Trip-based estimate. Informational; never combined with the figure above. */
  estimatedTripFuelCost: number;
  /** Never negative; use overBy instead. */
  remaining: number;
  overBy: number;
  progress: number;
  status: BudgetStatus;
  /** Distinct from actualRefillSpend === 0, which is a real zero. */
  actualUnavailable: boolean;
}

export class ActualSpendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActualSpendUnavailableError';
  }
}

/**
 * One call for the whole Budget screen.
 *
 * estimateMonthlyFuelSpend is left untouched because the Home dashboard also
 * depends on it, so switching the main figure to actual spending here does not
 * silently change Home.
 */
export async function getMonthlyBudgetOverview(
  userId: string,
  year: number,
  month: number
): Promise<MonthlyBudgetOverview> {
  const [budgets, actual, estimated] = await Promise.all([
    fetchBudgets(userId),
    fetchMyAcceptedRefillTotal(year, month).catch((error) => {
      throw new ActualSpendUnavailableError(
        error instanceof Error ? error.message : 'Unable to load refill spending.'
      );
    }),
    estimateMonthlyFuelSpend(userId, year, month).catch(() => 0),
  ]);

  const budget = budgets.find((b) => b.year === year && b.month === month) ?? null;
  const limitAmount = budget?.limit_amount ?? 0;
  const thresholdPercent = budget?.alert_threshold_percent ?? 80;
  const spent = actual;

  const overBy = Math.max(spent - limitAmount, 0);
  const remaining = Math.max(limitAmount - spent, 0);
  const progress = limitAmount > 0 ? Math.min(spent / limitAmount, 1) : 0;

  return {
    budget,
    limitAmount,
    thresholdPercent,
    actualRefillSpend: spent,
    estimatedTripFuelCost: estimated,
    remaining,
    overBy,
    progress,
    status: budget ? budgetAlertStatus(spent, limitAmount, thresholdPercent) : 'unset',
    actualUnavailable: false,
  };
}

/** Compact per-month rows for the "other months" list. */
export interface MonthBudgetSummary {
  year: number;
  month: number;
  limitAmount: number;
  actualRefillSpend: number;
  status: BudgetStatus;
}

export async function fetchMonthBudgetSummaries(
  userId: string,
  year: number,
  month: number
): Promise<MonthBudgetSummary[]> {
  const budgets = await fetchBudgets(userId);

  return Promise.all(
    budgets.map(async (b) => {
      const actual = await fetchMyAcceptedRefillTotal(b.year, b.month).catch(() => 0);
      return {
        year: b.year,
        month: b.month,
        limitAmount: b.limit_amount,
        actualRefillSpend: actual,
        status: budgetAlertStatus(actual, b.limit_amount, b.alert_threshold_percent),
      };
    })
  );
}
