import type { DoeFuelTypeCode } from '@/constants/fuelTypes';
import type { DoeRegionCode } from '@/constants/regions';
import {
  ActualSpendUnavailableError,
  fetchBudgets,
  getMonthlyBudgetOverview,
  type BudgetStatus,
} from '@/lib/services/budgets';
import {
  fetchFreshVerifiedPrices,
  type VerifiedCommunityPrice,
} from '@/lib/services/communityReports';
import { fetchLowestPrice, type FuelPriceRow } from '@/lib/services/fuelPrices';
import { supabase } from '@/lib/supabase';

export const DASHBOARD_REGION: DoeRegionCode = 'NCR';
export const DASHBOARD_FUEL_TYPE: DoeFuelTypeCode = 'RON_91';

export type DashboardPriceSource = 'community' | 'doe';

export interface DashboardPriceSummary {
  price: number;
  stationName: string;
  location: string;
  source: DashboardPriceSource;
}

export interface DashboardBudgetSummary {
  hasBudget: boolean;
  limitAmount: number;
  /**
   * ACTUAL personal fuel spending: accepted refill allocations assigned to this
   * user, on refills that are not voided, for the refill's occurred month.
   * This is the same figure the Budget page shows.
   */
  spent: number;
  /**
   * Trip-based estimate. Informational only, never added to `spent`: the trips
   * and the refills usually describe the same journeys, so summing them would
   * double count.
   */
  estimatedTripSpend: number;
  /** Never negative; use overBy instead. */
  remaining: number;
  overBy: number;
  /** 0..1, already clamped. */
  progress: number;
  status: BudgetStatus;
  /**
   * True when actual spending could not be read (for example the Phase 2 RPC is
   * not deployed yet). Distinct from a real zero, so the UI never claims the
   * user has spent nothing.
   */
  actualUnavailable: boolean;
}

export interface DashboardReport {
  id: string;
  createdAt: string;
  stationName: string;
  fuelTypeName: string;
  price: number;
  status: string;
}

function communityPriceSummary(rows: VerifiedCommunityPrice[]): DashboardPriceSummary | null {
  const row = rows
    .filter((item) => Number.isFinite(item.reported_price) && item.reported_price > 0)
    .sort((a, b) => a.reported_price - b.reported_price)[0];

  if (!row) return null;

  return {
    price: row.reported_price,
    stationName: row.station_name || 'Station',
    location: row.address || 'NCR',
    source: 'community',
  };
}

function doePriceSummary(row: FuelPriceRow | null): DashboardPriceSummary | null {
  if (!row) return null;

  return {
    price: row.price_per_liter,
    stationName: row.oil_company?.name || 'DOE price',
    location: row.area_name || row.region?.name || 'NCR',
    source: 'doe',
  };
}

/**
 * Read-only dashboard price summary. Community prices are preferred because they
 * identify a station; the existing DOE lowest-price service is the fallback.
 */
export async function fetchDashboardPriceSummary(
  regionCode: DoeRegionCode = DASHBOARD_REGION,
  fuelTypeCode: DoeFuelTypeCode = DASHBOARD_FUEL_TYPE,
): Promise<DashboardPriceSummary | null> {
  const [communityRows, doeRow] = await Promise.all([
    fetchFreshVerifiedPrices(regionCode, fuelTypeCode).catch(() => [] as VerifiedCommunityPrice[]),
    fetchLowestPrice(regionCode, fuelTypeCode).catch(() => null),
  ]);

  return communityPriceSummary(communityRows) ?? doePriceSummary(doeRow);
}

/**
 * Current-month budget summary for the Home dashboard.
 *
 * Composed through getMonthlyBudgetOverview, the same function the Budget page
 * uses, so Home and Budget cannot drift apart or disagree about what "spent"
 * means. The trip estimate is still carried, but only as a separate field.
 */
export async function fetchDashboardBudgetSummary(
  userId: string,
  year: number,
  month: number,
): Promise<DashboardBudgetSummary> {
  try {
    const overview = await getMonthlyBudgetOverview(userId, year, month);
    return {
      hasBudget: Boolean(overview.budget),
      limitAmount: overview.limitAmount,
      spent: overview.actualRefillSpend,
      estimatedTripSpend: overview.estimatedTripFuelCost,
      remaining: overview.remaining,
      overBy: overview.overBy,
      progress: overview.progress,
      status: overview.status,
      actualUnavailable: false,
    };
  } catch (error) {
    if (!(error instanceof ActualSpendUnavailableError)) throw error;

    // Actual spending is unreadable. Keep the limit visible if we can, but never
    // substitute a fake zero -- the UI renders this as unavailable instead.
    const budget = (await fetchBudgets(userId)).find(
      (item) => item.year === year && item.month === month
    );

    return {
      hasBudget: Boolean(budget),
      limitAmount: budget?.limit_amount ?? 0,
      spent: 0,
      estimatedTripSpend: 0,
      remaining: 0,
      overBy: 0,
      progress: 0,
      status: budget ? 'ok' : 'unset',
      actualUnavailable: true,
    };
  }
}

type RecentReportRow = {
  id: string;
  reported_price: number;
  status: string;
  created_at: string;
  station: { name: string } | { name: string }[] | null;
  fuel_type: { name: string } | { name: string }[] | null;
};

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Read-only feed of reports submitted by the signed-in user. */
export async function fetchRecentUserReports(
  userId: string,
  limit = 8,
): Promise<DashboardReport[]> {
  const { data, error } = await supabase
    .from('community_fuel_reports')
    .select(
      `
      id,
      reported_price,
      status,
      created_at,
      station:fuel_stations ( name ),
      fuel_type:fuel_types ( name )
    `,
    )
    .eq('reported_by', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as unknown as RecentReportRow[]).map((row) => {
    const station = unwrapOne(row.station);
    const fuelType = unwrapOne(row.fuel_type);
    return {
      id: row.id,
      createdAt: row.created_at,
      stationName: station?.name ?? 'Station',
      fuelTypeName: fuelType?.name ?? 'Fuel',
      price: row.reported_price,
      status: row.status,
    };
  });
}
