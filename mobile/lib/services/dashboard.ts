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
import { fetchMyPendingAllocations } from '@/lib/services/refillAllocations';
import { supabase } from '@/lib/supabase';

/**
 * Fallbacks for when the user has told us nothing.
 *
 * These are used ONLY when region and fuel type cannot be resolved, and both
 * are surfaced in the UI as an explicit "<X> reference" label. They are never
 * presented as the user's location: a fixed default that reads as local is the
 * one thing this pass exists to remove.
 */
export const DASHBOARD_REGION: DoeRegionCode = 'NCR';
export const DASHBOARD_FUEL_TYPE: DoeFuelTypeCode = 'RON_91';

/**
 * `fuel_types.code` -> the DOE code the price services accept.
 *
 * A vehicle's `fuel_type_id` is a UUID into `fuel_types`, but every price query
 * takes a DOE fuel CODE, so the id has to be resolved to a row and then mapped
 * through a whitelist. The explicit map (rather than a cast) means an
 * unrecognised or future fuel type resolves to null instead of reaching the
 * price query as a bogus code.
 *
 * This mirrors the same mapping in `tripFuelPrice.ts`, which does the same
 * id -> code resolution for the Trip screen.
 */
const FUEL_CODE_TO_DOE: Record<string, DoeFuelTypeCode> = {
  RON_91: 'RON_91',
  RON_95: 'RON_95',
  RON_97: 'RON_97',
  RON_100: 'RON_100',
  DIESEL: 'DIESEL',
  DIESEL_PLUS: 'DIESEL_PLUS',
  KEROSENE: 'KEROSENE',
};

/**
 * A vehicle's `fuel_type_id` -> the DOE fuel code used to price it.
 *
 * Returns null when the vehicle has no usable fuel type, so the caller can fall
 * back explicitly rather than silently guessing.
 */
export async function resolveVehicleFuelCode(
  fuelTypeId: string | null | undefined
): Promise<DoeFuelTypeCode | null> {
  if (!fuelTypeId) return null;
  const { data, error } = await supabase
    .from('fuel_types')
    .select('id, code')
    .eq('id', fuelTypeId)
    .maybeSingle();

  // A failed lookup must not break Home: the caller falls back to the labelled
  // reference fuel instead.
  if (error) return null;
  if (!data?.code) return null;
  return FUEL_CODE_TO_DOE[data.code] ?? null;
}

export type DashboardPriceSource = 'community' | 'doe';

export interface DashboardPriceSummary {
  price: number;
  stationName: string;
  location: string;
  source: DashboardPriceSource;
  /**
   * The macro-region this figure was actually priced for.
   *
   * Null when the region could not be resolved and the labelled fallback region
   * was used, which is what makes the UI say "reference" instead of implying
   * this is where the user is.
   */
  regionCode: DoeRegionCode | null;
  /** True when this is the fixed fallback region, not the user's own. */
  isRegionFallback: boolean;
  /** True when this is the fixed fallback fuel, not the vehicle's own. */
  isFuelFallback: boolean;
  /** The DOE fuel code actually queried, e.g. 'DIESEL'. */
  fuelCode: DoeFuelTypeCode;
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

/** Provenance flags attached to whichever price row wins the community/DOE race. */
type PriceQueryContext = Pick<
  DashboardPriceSummary,
  'regionCode' | 'isRegionFallback' | 'isFuelFallback' | 'fuelCode'
>;

function communityPriceSummary(
  rows: VerifiedCommunityPrice[],
  context: PriceQueryContext
): DashboardPriceSummary | null {
  const row = rows
    .filter((item) => Number.isFinite(item.reported_price) && item.reported_price > 0)
    .sort((a, b) => a.reported_price - b.reported_price)[0];

  if (!row) return null;

  return {
    price: row.reported_price,
    stationName: row.station_name || 'Station',
    // No invented region: an absent address reads as unknown, not as NCR.
    location: row.address || 'Address unavailable',
    source: 'community',
    ...context,
  };
}

function doePriceSummary(
  row: FuelPriceRow | null,
  context: PriceQueryContext
): DashboardPriceSummary | null {
  if (!row) return null;

  return {
    price: row.price_per_liter,
    // DOE prices are company/area reference figures, not a named station.
    stationName: row.oil_company?.name || 'DOE price',
    location: row.area_name || row.region?.name || 'Region-wide reference',
    source: 'doe',
    ...context,
  };
}

/**
 * Read-only dashboard price summary. Community prices are preferred because they
 * identify a station; the existing DOE lowest-price service is the fallback.
 *
 * Region and fuel type are supplied explicitly by the caller. The parameter
 * defaults remain for any other caller, but Home always passes resolved values
 * so a fixed default can never silently masquerade as the user's own location.
 */
export async function fetchDashboardPriceSummary(
  regionCode: DoeRegionCode = DASHBOARD_REGION,
  fuelTypeCode: DoeFuelTypeCode = DASHBOARD_FUEL_TYPE,
  resolvedRegion: boolean = true,
  resolvedFuel: boolean = true
): Promise<DashboardPriceSummary | null> {
  const context: PriceQueryContext = {
    regionCode: resolvedRegion ? regionCode : null,
    isRegionFallback: !resolvedRegion,
    isFuelFallback: !resolvedFuel,
    fuelCode: fuelTypeCode,
  };

  const [communityRows, doeRow] = await Promise.all([
    fetchFreshVerifiedPrices(regionCode, fuelTypeCode).catch(() => [] as VerifiedCommunityPrice[]),
    fetchLowestPrice(regionCode, fuelTypeCode).catch(() => null),
  ]);

  return communityPriceSummary(communityRows, context) ?? doePriceSummary(doeRow, context);
}

/**
 * Refill shares waiting on the signed-in user's response.
 *
 * This is a SIGNAL ONLY. It is deliberately not folded into any budget figure:
 * Home's spend comes from accepted allocations alone, and a pending share is not
 * yet a personal charge. Adding it here would make the headline disagree with the
 * Budget page.
 */
export interface DashboardPendingSummary {
  count: number;
  total: number;
}

export async function fetchDashboardPendingSummary(): Promise<DashboardPendingSummary> {
  try {
    const rows = await fetchMyPendingAllocations();
    return {
      count: rows.length,
      total: rows.reduce((sum, row) => sum + Number(row.amount), 0),
    };
  } catch {
    // A missing Phase 2 RPC must not break Home. Zero here means "nothing we can
    // see", not "nothing pending" -- but it is far better than an error screen.
    return { count: 0, total: 0 };
  }
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

    // Every derived figure below is deliberately meaningless. `remaining`,
    // `overBy` and `progress` cannot be computed without `spent`, and `status`
    // is reported as 'unset' rather than 'ok' on purpose: 'ok' would assert the
    // user is under budget, which is exactly the claim this fallback exists to
    // avoid making. `actualUnavailable: true` is the real signal, and Home
    // branches on it before ever reading these fields.
    //
    // This is the one honest value the existing `BudgetStatus` union allows. A
    // dedicated 'unknown' status would be clearer still, but `BudgetStatus` is a
    // closed union consumed by `STATUS_META` in the Budget tab, so adding a
    // member is a change to that screen too and is deliberately out of scope.
    return {
      hasBudget: Boolean(budget),
      limitAmount: budget?.limit_amount ?? 0,
      spent: 0,
      estimatedTripSpend: 0,
      remaining: 0,
      overBy: 0,
      progress: 0,
      status: 'unset',
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
