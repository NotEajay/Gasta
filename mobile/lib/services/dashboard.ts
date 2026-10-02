import { NEARBY_STATION_RADIUS_KM } from '@/constants/communityReports';
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
import {
  bulletinAgeInDays,
  fetchBulletinWeeksForRegion,
  fetchFuelPricesForBulletin,
  type FuelPriceRow,
} from '@/lib/services/fuelPrices';
import { haversineKm } from '@/lib/services/location';
import { fetchMyPendingAllocations } from '@/lib/services/refillAllocations';
import { supabase } from '@/lib/supabase';

/** Assumed tank fill used only for the Home savings line (₱ saved vs regional average). */
export const DASHBOARD_RECO_FILL_LITERS = 40;

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

export interface DashboardRecoRunnerUp {
  rank: number;
  name: string;
  price: number;
}

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
  /**
   * True when this station was chosen as cheapest within
   * `NEARBY_STATION_RADIUS_KM` of the user's coordinates. Never true for DOE
   * reference rows or region-wide community fallbacks.
   */
  isNearbyRecommended: boolean;
  /** Straight-line km to the recommended station, when distance was computed. */
  distanceKm: number | null;
  /**
   * DOE bulletin week-start date (YYYY-MM-DD) when `source === 'doe'`.
   * Null for community picks.
   */
  bulletinDate: string | null;
  /** Days since estimated DOE post date; null when unknown. */
  bulletinAgeDays: number | null;
  /**
   * Change vs the same brand on the previous bulletin week
   * (`current - previous`). Negative = cheaper than last week.
   */
  vsLastBulletin: number | null;
  /**
   * Estimated ₱ saved on a `DASHBOARD_RECO_FILL_LITERS` fill vs the regional
   * average of this week's company prices. Null when average is unavailable or
   * the pick is not below average.
   */
  savingsOnFill: number | null;
  /** Next-cheapest companies this week (ranks 2–3), for the comparison list. */
  runnersUp: DashboardRecoRunnerUp[];
}

/** Optional GPS fix used to prefer the cheapest nearby verified station. */
export interface DashboardUserCoords {
  latitude: number;
  longitude: number;
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

type RankedCommunityPrice = {
  row: VerifiedCommunityPrice;
  distanceKm: number | null;
  nearby: boolean;
};

/**
 * Prefer the cheapest verified station within the nearby radius; on a price tie,
 * prefer the nearer one. Without coords (or with no station inside the radius),
 * fall back to the cheapest verified price in the region — never inventing a
 * "nearby" claim for that fallback.
 */
function pickRecommendedCommunityPrice(
  rows: VerifiedCommunityPrice[],
  userCoords: DashboardUserCoords | null
): RankedCommunityPrice | null {
  const priced = rows.filter(
    (item) => Number.isFinite(item.reported_price) && item.reported_price > 0
  );
  if (priced.length === 0) return null;

  if (userCoords) {
    const nearby = priced
      .map((row) => {
        const distanceKm =
          row.latitude != null && row.longitude != null
            ? haversineKm(
                userCoords.latitude,
                userCoords.longitude,
                Number(row.latitude),
                Number(row.longitude)
              )
            : null;
        return { row, distanceKm, nearby: distanceKm != null && distanceKm <= NEARBY_STATION_RADIUS_KM };
      })
      .filter((item) => item.nearby);

    if (nearby.length > 0) {
      nearby.sort((a, b) => {
        const priceDelta = a.row.reported_price - b.row.reported_price;
        if (priceDelta !== 0) return priceDelta;
        return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
      });
      return nearby[0];
    }
  }

  const cheapest = [...priced].sort((a, b) => a.reported_price - b.reported_price)[0];
  return { row: cheapest, distanceKm: null, nearby: false };
}

function communityPriceSummary(
  rows: VerifiedCommunityPrice[],
  context: PriceQueryContext,
  userCoords: DashboardUserCoords | null
): DashboardPriceSummary | null {
  const pick = pickRecommendedCommunityPrice(rows, userCoords);
  if (!pick) return null;

  const { row, distanceKm, nearby } = pick;
  return {
    price: row.reported_price,
    stationName: row.station_name || 'Station',
    // No invented region: an absent address reads as unknown, not as NCR.
    location: row.address || 'Address unavailable',
    source: 'community',
    isNearbyRecommended: nearby,
    distanceKm: nearby ? distanceKm : null,
    bulletinDate: null,
    bulletinAgeDays: null,
    vsLastBulletin: null,
    savingsOnFill: null,
    runnersUp: [],
    ...context,
  };
}

/** One cheapest row per oil company, already sorted ascending by price. */
function uniqueCompaniesByPrice(rows: FuelPriceRow[]): FuelPriceRow[] {
  const seen = new Set<string>();
  const out: FuelPriceRow[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.price_per_liter) || row.price_per_liter <= 0) continue;
    const key = row.oil_company?.id || row.oil_company?.name || row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function savingsVsAverage(cheapest: number, prices: number[]): number | null {
  if (prices.length < 2) return null;
  const average = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  const saved = (average - cheapest) * DASHBOARD_RECO_FILL_LITERS;
  return saved > 0.5 ? saved : null;
}

async function doeRecommendationSummary(
  regionCode: DoeRegionCode,
  fuelTypeCode: DoeFuelTypeCode,
  context: PriceQueryContext
): Promise<DashboardPriceSummary | null> {
  const weeks = await fetchBulletinWeeksForRegion(regionCode, 2).catch(() => []);
  const currentWeek = weeks[0];
  if (!currentWeek) return null;

  const currentRows = await fetchFuelPricesForBulletin(
    currentWeek.id,
    regionCode,
    fuelTypeCode
  ).catch(() => [] as FuelPriceRow[]);
  const ranked = uniqueCompaniesByPrice(currentRows);
  const winner = ranked[0];
  if (!winner) return null;

  let vsLastBulletin: number | null = null;
  const previousWeek = weeks[1];
  if (previousWeek && winner.oil_company?.id) {
    const previousRows = await fetchFuelPricesForBulletin(
      previousWeek.id,
      regionCode,
      fuelTypeCode
    ).catch(() => [] as FuelPriceRow[]);
    const prev = previousRows.find(
      (row) => row.oil_company?.id === winner.oil_company.id
    );
    if (prev && Number.isFinite(prev.price_per_liter)) {
      vsLastBulletin = winner.price_per_liter - prev.price_per_liter;
    }
  }

  const prices = ranked.map((row) => row.price_per_liter);
  const runnersUp: DashboardRecoRunnerUp[] = ranked.slice(1, 3).map((row, index) => ({
    rank: index + 2,
    name: row.oil_company?.name || 'Brand',
    price: row.price_per_liter,
  }));

  return {
    price: winner.price_per_liter,
    stationName: winner.oil_company?.name || 'DOE price',
    location: winner.area_name || winner.region?.name || 'Region-wide reference',
    source: 'doe',
    isNearbyRecommended: false,
    distanceKm: null,
    bulletinDate: winner.bulletin?.bulletin_date ?? currentWeek.bulletin_date,
    bulletinAgeDays: bulletinAgeInDays(
      winner.bulletin?.bulletin_date ?? currentWeek.bulletin_date
    ),
    vsLastBulletin,
    savingsOnFill: savingsVsAverage(winner.price_per_liter, prices),
    runnersUp,
    ...context,
  };
}

/**
 * Read-only dashboard price recommendation for Home.
 *
 * Preference order (Home surfaces "lowest this week"):
 * 1. Lowest DOE company price from the latest bulletin for the region, with
 *    runners-up, week-over-week delta, and fill-up savings vs average.
 * 2. Cheapest fresh verified community price within `NEARBY_STATION_RADIUS_KM`
 *    (when coords are available), else cheapest verified in the region.
 */
export async function fetchDashboardPriceSummary(
  regionCode: DoeRegionCode = DASHBOARD_REGION,
  fuelTypeCode: DoeFuelTypeCode = DASHBOARD_FUEL_TYPE,
  resolvedRegion: boolean = true,
  resolvedFuel: boolean = true,
  userCoords: DashboardUserCoords | null = null
): Promise<DashboardPriceSummary | null> {
  const context: PriceQueryContext = {
    regionCode: resolvedRegion ? regionCode : null,
    isRegionFallback: !resolvedRegion,
    isFuelFallback: !resolvedFuel,
    fuelCode: fuelTypeCode,
  };

  const [doeSummary, communityRows] = await Promise.all([
    doeRecommendationSummary(regionCode, fuelTypeCode, context).catch(() => null),
    fetchFreshVerifiedPrices(regionCode, fuelTypeCode).catch(() => [] as VerifiedCommunityPrice[]),
  ]);

  return doeSummary ?? communityPriceSummary(communityRows, context, userCoords);
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
