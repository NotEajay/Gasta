import { recentMonths, type InsightMonth } from '@/lib/fuelInsights';
import { fetchMonthlyBudgetAnalytics } from '@/lib/services/budgetAnalytics';
import { fetchBudgets } from '@/lib/services/budgets';

/** Bounded monthly RPC reads retain revoked collaborators' own spending history.
 * A client-side join would silently lose those refills under the existing RLS.
 */
export async function fetchFuelInsightHistory(
  userId: string,
  year: number,
  month: number,
  count = 6,
  now = new Date(),
): Promise<InsightMonth[]> {
  if (!userId || !Number.isInteger(year) || year < 1900 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Choose a valid month to view fuel history.');
  }
  const periods = recentMonths(year, month, count);
  const [budgets, analytics] = await Promise.all([
    fetchBudgets(userId).catch(() => null),
    Promise.all(periods.map(async (period) => {
      try { return await fetchMonthlyBudgetAnalytics(period.year, period.month); }
      catch { return null; }
    })),
  ]);
  const currentKey = now.getFullYear() * 12 + now.getMonth();
  return periods.map((period, index) => {
    const data = analytics[index];
    const amount = data?.actualRefillSpend;
    const refills = data?.refillCount;
    const validRows = data?.vehicles.every((row) => Number.isFinite(row.actualSpend) && row.actualSpend >= 0 &&
      Number.isInteger(row.relevantRefillCount) && row.relevantRefillCount >= 0) ?? false;
    const sum = data?.vehicles.reduce((total, row) => total + row.actualSpend, 0) ?? 0;
    const countSum = data?.vehicles.reduce((total, row) => total + row.relevantRefillCount, 0) ?? 0;
    const available = amount != null && Number.isFinite(amount) && amount >= 0 &&
      refills != null && Number.isInteger(refills) && refills >= 0 && validRows &&
      Math.abs(sum - amount) < 0.02 && countSum === refills && (refills > 0 || amount === 0);
    const key = period.year * 12 + period.month - 1;
    const budget = budgets?.find((row) => row.year === period.year && row.month === period.month) ?? null;
    return {
      ...period,
      period: key === currentKey ? 'current' : key > currentKey ? 'future' : 'complete',
      available,
      actualSpend: available ? amount! : null,
      refillCount: available ? refills! : null,
      vehicles: available ? data!.vehicles : [],
      budget,
      budgetAvailable: budgets !== null && (!budget || (Number.isFinite(budget.limit_amount) && budget.limit_amount > 0)),
    };
  });
}
