import { formatPeso } from '@/lib/format';
import type { VehicleBudgetRow } from '@/lib/services/budgetAnalytics';
import type { FuelBudget } from '@/types';

export interface InsightMonth {
  year: number;
  month: number;
  period: 'complete' | 'current' | 'future';
  available: boolean;
  actualSpend: number | null;
  refillCount: number | null;
  vehicles: VehicleBudgetRow[];
  budget: FuelBudget | null;
  budgetAvailable: boolean;
}

export interface FuelInsight {
  key: 'spending' | 'budget' | 'vehicle';
  label: string;
  title: string;
  detail: string;
  /** Short numeric evidence for compact dashboard cards. */
  summary?: string;
  period: string;
  tone: 'neutral' | 'positive' | 'caution';
  year: number;
  month: number;
}

export function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-PH', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function monthRange(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const name = date.toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${name} 1–${last}, ${year}`;
}

export function recentMonths(year: number, month: number, count: number) {
  return Array.from({ length: Math.min(6, Math.max(1, count)) }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });
}

/** Explanations of recorded amounts only. Never projections or claimed savings. */
export function buildFuelInsights(months: InsightMonth[]): FuelInsight[] {
  const current = months[0];
  if (!current) return [];
  const completed = months.filter((entry) => entry.period === 'complete');
  const [latest, earlier] = completed;
  const selectedPeriod = `${monthRange(current.year, current.month)}${current.period === 'current' ? ' · so far' : ''}`;
  const base = { year: current.year, month: current.month };
  let spending: FuelInsight = {
    ...base, key: 'spending', label: 'Spending change', title: 'Not enough history yet',
    detail: 'Record refills in two completed months to see a comparison.',
    period: 'Completed months only', tone: 'neutral',
  };

  if (latest && earlier) {
    spending = { ...spending, year: latest.year, month: latest.month,
      period: `${monthRange(latest.year, latest.month)} vs ${monthRange(earlier.year, earlier.month)}` };
    if (!latest.available || !earlier.available) {
      spending.title = 'Comparison unavailable';
      spending.detail = 'We could not load both months. Try again to compare your spending.';
    } else if ((latest.refillCount ?? 0) > 0 && (earlier.refillCount ?? 0) > 0 &&
      latest.actualSpend != null && earlier.actualSpend != null) {
      const delta = Math.round((latest.actualSpend - earlier.actualSpend) * 100) / 100;
      const percent = earlier.actualSpend > 0 ? Math.abs(delta) / earlier.actualSpend * 100 : null;
      spending.title = delta === 0 ? 'Recorded spending stayed the same' : percent == null
        ? `${formatPeso(Math.abs(delta))} ${delta < 0 ? 'less' : 'more'} recorded`
        : `${percent > 0 && percent < 0.1 ? '<0.1' : percent.toFixed(1)}% ${delta < 0 ? 'less' : 'more'} recorded`;
      spending.summary = `${formatPeso(latest.actualSpend)} vs ${formatPeso(earlier.actualSpend)}`;
      spending.detail = `${formatPeso(latest.actualSpend)} vs ${formatPeso(earlier.actualSpend)} in accepted refill expenses.`;
      spending.tone = delta < 0 ? 'positive' : 'neutral';
    } else if ((latest.refillCount ?? 0) === 0) {
      spending.title = `No refills recorded in ${monthLabel(latest.year, latest.month)}`;
      spending.detail = 'There is not enough recorded activity to describe a spending trend.';
    }
  }

  let budget: FuelInsight = {
    ...base, key: 'budget', label: 'Budget status', title: 'No budget set',
    detail: 'Set a monthly budget in Budget to see how your recorded spending compares.',
    period: selectedPeriod, tone: 'neutral',
  };
  const limit = current.budget?.limit_amount;
  if (!current.available || !current.budgetAvailable) {
    budget.title = 'Budget status unavailable';
    budget.detail = 'We could not load the figures needed to check this month.';
  } else if (limit != null && Number.isFinite(limit) && limit > 0 && current.actualSpend != null) {
    const spend = current.actualSpend;
    const percent = spend / limit * 100;
    const threshold = current.budget?.alert_threshold_percent ?? 80;
    budget.title = spend > limit ? `${formatPeso(spend - limit)} over budget`
      : spend === limit ? 'Budget reached' : `${formatPeso(limit - spend)} left in your budget`;
    budget.detail = `${formatPeso(spend)} of ${formatPeso(limit)} recorded (${percent > 0 && percent < 1 ? '<1' : Math.round(percent)}% used).`;
    budget.tone = percent >= threshold ? 'caution' : 'neutral';
  }

  const top = [...current.vehicles].filter((row) => row.actualSpend > 0)
    .sort((a, b) => b.actualSpend - a.actualSpend || a.label.localeCompare(b.label))[0];
  let vehicle: FuelInsight = {
    ...base, key: 'vehicle', label: 'Largest vehicle expense', title: 'No refill expenses recorded',
    detail: 'Your largest vehicle expense will appear after you accept a refill expense.',
    period: selectedPeriod, tone: 'neutral',
  };
  if (!current.available) {
    vehicle.title = 'Vehicle breakdown unavailable';
    vehicle.detail = 'Your vehicle spending could not be loaded. Try again shortly.';
  } else if (top && current.actualSpend != null && current.actualSpend > 0) {
    vehicle.title = top.label;
    vehicle.summary = `${formatPeso(top.actualSpend)} · ${(top.actualSpend / current.actualSpend * 100).toFixed(1)}%`;
    vehicle.detail = `${formatPeso(top.actualSpend)} · ${(top.actualSpend / current.actualSpend * 100).toFixed(1)}% of your recorded refill spending. Includes only your accepted share.`;
  }
  return [spending, budget, vehicle];
}

/** Route parameters are untrusted; ignore malformed or out-of-range periods. */
export function parseInsightPeriod(year: unknown, month: unknown): { year: number; month: number } | null {
  if (typeof year !== 'string' || typeof month !== 'string' || !/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month)) return null;
  const y = Number(year), m = Number(month);
  return y >= 1900 && y <= 9999 && m >= 1 && m <= 12 ? { year: y, month: m } : null;
}
