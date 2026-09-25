import type { DoeFuelTypeCode } from '@/constants/fuelTypes';
import type { DoeRegionCode } from '@/constants/regions';
import { estimateMonthlyFuelSpend, fetchBudgets } from '@/lib/services/budgets';
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
  spent: number;
  remaining: number;
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

/** Read-only current-month budget summary composed from the existing budget services. */
export async function fetchDashboardBudgetSummary(
  userId: string,
  year: number,
  month: number,
): Promise<DashboardBudgetSummary> {
  const budgets = await fetchBudgets(userId);
  const budget = budgets.find((item) => item.year === year && item.month === month);

  if (!budget) {
    return { hasBudget: false, limitAmount: 0, spent: 0, remaining: 0 };
  }

  const spent = await estimateMonthlyFuelSpend(userId, year, month);
  return {
    hasBudget: true,
    limitAmount: budget.limit_amount,
    spent,
    remaining: Math.max(budget.limit_amount - spent, 0),
  };
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
