import type { DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, REGION_CENTROIDS, type DoeRegionCode } from '@/constants/regions';
import {
  fetchFreshVerifiedPrices,
  type VerifiedCommunityPrice,
} from '@/lib/services/communityReports';
import {
  fetchFuelPricesForBulletin,
  fetchLatestBulletinForRegion,
  type BulletinWeek,
} from '@/lib/services/fuelPrices';
import { supabase } from '@/lib/supabase';

/**
 * Trusted fuel price for the Trip Cost Optimizer.
 *
 * Authority order, highest first:
 *   1. a FRESH VERIFIED community price for the trip's region + fuel
 *   2. the official DOE bulletin price for that same region + fuel
 *   3. nothing -- reported as unavailable
 *
 * Pending / "Unverified" community reports are deliberately never consulted.
 * The Prices screen *displays* them so drivers can confirm them, but a price
 * nobody has confirmed must not drive a cost ranking. `fetchPendingReports` is
 * intentionally not imported here, so there is no second, divergent
 * verification rule to keep in sync: trust comes from
 * `fresh_verified_community_prices`, the same source Prices treats as
 * authoritative.
 *
 * Freshness is not re-implemented. That view already filters to
 * `status = 'verified' AND verified_at >= now() - 7 days`, so anything it
 * returns is verified and recent by definition.
 */

export type TripFuelPriceSource = 'community_verified' | 'doe_area' | 'doe_region';

export interface TripFuelPrice {
  pricePerLiter: number;
  source: TripFuelPriceSource;
  /** Short provenance for the price line, e.g. "DOE bulletin". */
  sourceLabel: string;
  /** The DOE bulletin week, when the source is DOE-derived. */
  bulletinDate: string | null;
  /** Verification timestamp for a community price. */
  verifiedAt: string | null;
  regionCode: DoeRegionCode;
  regionName: string;
  fuelCode: DoeFuelTypeCode;
  fuelName: string;
  /**
   * How specific the figure is. `area` means the price is for the place the trip
   * starts; `region` means it is a regional figure used because the bulletin
   * has no local row. The UI must say which, because a regional number
   * presented as if it were local would overstate precision.
   */
  locality: 'area' | 'region';
  /** The matched bulletin area, when one was resolved. */
  areaName: string | null;
  /**
   * Compact provenance for the result card, e.g.
   * "Lowest trusted price found in Naga City" or
   * "Regional DOE estimate - Sep 15".
   */
  detail: string;
}

export type TripFuelPriceUnavailableReason =
  | 'no_region'
  | 'no_vehicle_fuel'
  | 'unsupported_fuel'
  | 'no_bulletin'
  | 'no_doe_price'
  | 'error';

export type TripFuelPriceResult =
  | { status: 'ok'; price: TripFuelPrice }
  | { status: 'unavailable'; reason: TripFuelPriceUnavailableReason; message: string };

/** "Sep 22", or "Sep 22, 2025" when the year differs from now. */
function shortDate(date: Date, now: Date): string {
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function regionNameOf(code: DoeRegionCode): string {
  return DOE_REGIONS.find((r) => r.code === code)?.name ?? code;
}

/**
 * Which DOE pricing area a trip belongs to.
 *
 * The optimizer has no region of its own, so the trip's geography is derived
 * from coordinates the screen already holds -- destination first (where the
 * trip is heading, and where fuel would be bought), then origin. Matching is
 * nearest-centroid against `REGION_CENTROIDS`, the same constant Prices and
 * Report already use; no new geography is invented.
 */
export function regionForTrip(
  points: ({ latitude: number; longitude: number } | null | undefined)[]
): DoeRegionCode | null {
  for (const point of points) {
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    let best: DoeRegionCode | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const region of DOE_REGIONS) {
      const centroid = REGION_CENTROIDS[region.code];
      // Equirectangular approximation: ample over the Philippine span, and it
      // avoids a geo dependency for one nearest-centroid lookup.
      const dLat = point.latitude - centroid.latitude;
      const dLng =
        (point.longitude - centroid.longitude) * Math.cos((point.latitude * Math.PI) / 180);
      const distance = dLat * dLat + dLng * dLng;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = region.code;
      }
    }
    if (best) return best;
  }
  return null;
}

const FUEL_CODE_TO_DOE: Record<string, DoeFuelTypeCode> = {
  RON_91: 'RON_91',
  RON_95: 'RON_95',
  RON_97: 'RON_97',
  RON_100: 'RON_100',
  DIESEL: 'DIESEL',
  DIESEL_PLUS: 'DIESEL_PLUS',
  KEROSENE: 'KEROSENE',
};

/** A vehicle stores the same `fuel_types` row the DOE prices use. */
async function resolveFuel(
  fuelTypeId: string
): Promise<{ code: DoeFuelTypeCode; name: string } | null> {
  const { data, error } = await supabase
    .from('fuel_types')
    .select('id, code, name')
    .eq('id', fuelTypeId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.code) return null;
  const code = FUEL_CODE_TO_DOE[data.code];
  if (!code) return null;
  return { code, name: data.name };
}

function lowestVerified(verified: VerifiedCommunityPrice[]): VerifiedCommunityPrice | null {
  const usable = verified.filter(
    (row) => typeof row.reported_price === 'number' && row.reported_price > 0
  );
  if (usable.length === 0) return null;
  return usable.reduce((best, row) => (row.reported_price < best.reported_price ? row : best));
}

/**
 * Resolve the trusted price for a trip.
 *
 * Batched: at most one fuel-type lookup, one bulletin lookup, one DOE price
 * query and one verified-community query for the whole trip, no matter how many
 * candidate stations or routes exist. There is deliberately no per-station
 * querying.
 */
export async function resolveTripFuelPrice(input: {
  fuelTypeId: string | null | undefined;
  regionCode: DoeRegionCode | null;
  /**
   * A bulletin area known to match the trip origin, when one could be
   * resolved. When present the price is looked up area-first so the figure is
   * genuinely local; when absent the region minimum is used and labelled as a
   * regional estimate instead of being passed off as local.
   */
  areaName?: string | null;
  now?: Date;
}): Promise<TripFuelPriceResult> {
  const now = input.now ?? new Date();
  const areaName = input.areaName ?? null;

  if (!input.regionCode) {
    return {
      status: 'unavailable',
      reason: 'no_region',
      message: 'Pick an origin so the correct DOE pricing area can be used.',
    };
  }
  if (!input.fuelTypeId) {
    return {
      status: 'unavailable',
      reason: 'no_vehicle_fuel',
      message: 'Select a vehicle so its fuel type is known.',
    };
  }

  let fuel: { code: DoeFuelTypeCode; name: string } | null;
  let bulletin: BulletinWeek | null;
  try {
    [fuel, bulletin] = await Promise.all([
      resolveFuel(input.fuelTypeId),
      fetchLatestBulletinForRegion(input.regionCode),
    ]);
  } catch {
    return { status: 'unavailable', reason: 'error', message: 'Could not load current fuel prices.' };
  }

  if (!fuel) {
    return {
      status: 'unavailable',
      reason: 'unsupported_fuel',
      message: 'This vehicle’s fuel type has no DOE bulletin price.',
    };
  }
  if (!bulletin) {
    return {
      status: 'unavailable',
      reason: 'no_bulletin',
      message: `No DOE bulletin is available for ${regionNameOf(input.regionCode)} yet.`,
    };
  }

  const base = {
    bulletinDate: bulletin.bulletin_date,
    regionCode: input.regionCode,
    regionName: regionNameOf(input.regionCode),
    fuelCode: fuel.code,
    fuelName: fuel.name,
  };

  /*
   * Area first when the trip origin resolved to a bulletin area, region
   * second. Two bounded batched queries -- never one per station.
   */
  let localRows: { price_per_liter: number }[] = [];
  let regionRows: { price_per_liter: number }[] = [];
  let verified: VerifiedCommunityPrice[] = [];
  try {
    const areaPromise = areaName
      ? fetchFuelPricesForBulletin(bulletin.id, input.regionCode, fuel.code, areaName).catch(
          () => [] as { price_per_liter: number }[]
        )
      : Promise.resolve([] as { price_per_liter: number }[]);
    [localRows, regionRows, verified] = await Promise.all([
      areaPromise,
      fetchFuelPricesForBulletin(bulletin.id, input.regionCode, fuel.code, '').catch(() => []),
      fetchFreshVerifiedPrices(input.regionCode, fuel.code).catch(() => []),
    ]);
  } catch {
    return { status: 'unavailable', reason: 'error', message: 'Could not load current fuel prices.' };
  }

  /*
   * Verified community wins wherever it applies. It is only called LOCAL when
   * the station sits in the resolved area; otherwise it is still a trusted
   * price for the region and is labelled as such. Trip never picks a station,
   * so nothing here claims to be "the price at <station>".
   */
  const community = lowestVerified(verified);
  if (community) {
    const verifiedDate = new Date(community.verified_at);
    const reported = Number.isNaN(verifiedDate.getTime()) ? '' : shortDate(verifiedDate, now);
    const isLocal = areaName
      ? community.station_name.toLowerCase().includes(areaName.toLowerCase())
      : false;
    const place = isLocal && areaName ? areaName : regionNameOf(input.regionCode);
    return {
      status: 'ok',
      price: {
        ...base,
        pricePerLiter: community.reported_price,
        source: 'community_verified',
        sourceLabel: 'Community verified',
        verifiedAt: community.verified_at,
        locality: isLocal ? 'area' : 'region',
        areaName: isLocal ? areaName : null,
        detail: `Verified community price near ${place} · reported ${reported}`.trim(),
      },
    };
  }

  const usable = (rows: { price_per_liter: number }[]) =>
    rows
      .map((row) => row.price_per_liter)
      .filter((value): value is number => typeof value === 'number' && value > 0);

  const localPrices = usable(localRows);
  if (areaName && localPrices.length > 0) {
    return {
      status: 'ok',
      price: {
        ...base,
        pricePerLiter: Math.min(...localPrices),
        source: 'doe_area',
        sourceLabel: 'DOE bulletin',
        verifiedAt: null,
        locality: 'area',
        areaName,
        detail: `Lowest trusted price found in ${areaName}`,
      },
    };
  }

  const regionPrices = usable(regionRows);
  if (regionPrices.length > 0) {
    const bulletinDate = new Date(`${bulletin.bulletin_date}T00:00:00`);
    const when = Number.isNaN(bulletinDate.getTime())
      ? bulletin.bulletin_date
      : shortDate(bulletinDate, now);
    return {
      status: 'ok',
      price: {
        ...base,
        pricePerLiter: Math.min(...regionPrices),
        // Explicitly a REGIONAL figure. Shown as a fallback, never dressed up
        // as a price for the place the trip starts.
        source: 'doe_region',
        sourceLabel: 'DOE regional fallback',
        verifiedAt: null,
        locality: 'region',
        areaName: null,
        detail: `Regional DOE estimate · ${when}`,
      },
    };
  }

  return {
    status: 'unavailable',
    reason: 'no_doe_price',
    message: `No current DOE or verified community price is available for ${fuel.name} in ${regionNameOf(
      input.regionCode
    )}.`,
  };
}
