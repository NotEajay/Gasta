import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Per-vehicle budget analytics for one month.
 *
 * This mirrors the `AllocationDatabase` pattern in refillAllocations.ts: the
 * function arrives in a new migration, so the generated Database type does not
 * know it yet and the RPC is not deployed until deliberately applied. The
 * screen must degrade honestly rather than blank out.
 */
interface AnalyticsDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      monthly_budget_analytics: {
        Args: { p_year: number; p_month: number };
        Returns: AnalyticsRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Raw snake_case row as returned by monthly_budget_analytics(). */
type AnalyticsRow = {
  row_kind: string;
  vehicle_id: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  nickname: string | null;
  actual_spend: number | null;
  known_attributed_liters: number | null;
  relevant_refill_count: number | null;
  refills_with_liters_count: number | null;
  logged_trip_count: number | null;
  logged_distance_km: number | null;
  estimated_trip_cost: number | null;
};

const db = supabase as unknown as SupabaseClient<AnalyticsDatabase>;

/** PostgREST 40401/42883 = the object is not deployed to the project yet. */
function isMissingObject(error: { code?: string; message: string }, name: string): boolean {
  return (
    error.code === '42883' ||
    error.code === '40401' ||
    new RegExp(name, 'i').test(error.message)
  );
}

/**
 * One vehicle's month, as shown in the "By vehicle" section.
 *
 * `attributedLiters` is null whenever NO accepted refill for this vehicle
 * recorded liters. It is deliberately never coerced to 0, because 0 would claim
 * the user bought no fuel when the truth is that the amount is unknown.
 */
export interface VehicleBudgetRow {
  vehicleId: string;
  /** Precedence: nickname, then brand + model. Never a raw id. */
  label: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  /** Accepted allocations only. Never vehicle_refills.total_amount. */
  actualSpend: number;
  /** Proportional litres; null when unknown. See `describeLiters`. */
  attributedLiters: number | null;
  relevantRefillCount: number;
  refillsWithLitersCount: number;
  loggedTripCount: number;
  loggedDistanceKm: number;
  estimatedTripCost: number;
}

/** How much of the month actually has litres recorded, for honest wording. */
export type LitersCoverage =
  | { kind: 'none' }
  | { kind: 'partial'; known: number; relevant: number }
  | { kind: 'complete'; liters: number };

export interface BudgetAnalytics {
  vehicles: VehicleBudgetRow[];
  /** Month-wide logged trips, including trips with no vehicle set. */
  loggedTripCount: number;
  loggedDistanceKm: number;
  /** Trip-derived estimate. NEVER combined with actual spend. */
  estimatedTripCost: number;
}

/**
 * All per-vehicle budget analytics for one month, in a single call.
 *
 * Returns one row per vehicle the caller has accepted responsibility for OR
 * logged a trip on, plus a sentinel totals row. Bulk by design: the screen
 * never issues a per-vehicle query.
 */
export async function fetchMonthlyBudgetAnalytics(
  year: number,
  month: number
): Promise<BudgetAnalytics> {
  const { data, error } = await db.rpc('monthly_budget_analytics', {
    p_year: year,
    p_month: month,
  });

  if (error) {
    if (isMissingObject(error, 'monthly_budget_analytics')) {
      throw new BudgetAnalyticsUnavailableError(
        'Per-vehicle analytics are unavailable: monthly_budget_analytics is not deployed yet. Apply migration 20260928000001, then retry.'
      );
    }
    throw error;
  }

  const rows = (data ?? []) as AnalyticsRow[];
  const vehicles: VehicleBudgetRow[] = [];
  let totals: AnalyticsRow | null = null;

  for (const row of rows) {
    if (row.row_kind === 'total') {
      totals = row;
      continue;
    }
    // A vehicle row always carries an id; anything else is malformed and is
    // dropped rather than rendered as an unlabelled entry.
    if (!row.vehicle_id) continue;

    vehicles.push({
      vehicleId: row.vehicle_id,
      label: vehicleLabel(row.nickname, row.brand, row.model),
      brand: row.brand,
      model: row.model,
      year: row.year,
      actualSpend: Number(row.actual_spend ?? 0),
      attributedLiters:
        row.known_attributed_liters == null ? null : Number(row.known_attributed_liters),
      relevantRefillCount: Number(row.relevant_refill_count ?? 0),
      refillsWithLitersCount: Number(row.refills_with_liters_count ?? 0),
      loggedTripCount: Number(row.logged_trip_count ?? 0),
      loggedDistanceKm: Number(row.logged_distance_km ?? 0),
      estimatedTripCost: Number(row.estimated_trip_cost ?? 0),
    });
  }

  return {
    vehicles,
    loggedTripCount: Number(totals?.logged_trip_count ?? 0),
    loggedDistanceKm: Number(totals?.logged_distance_km ?? 0),
    estimatedTripCost: Number(totals?.estimated_trip_cost ?? 0),
  };
}

/**
 * Nickname wins when set; otherwise brand + model. Never falls back to an id.
 */
function vehicleLabel(
  nickname: string | null,
  brand: string | null,
  model: string | null
): string {
  if (nickname && nickname.trim()) return nickname.trim();
  const parts = [brand, model].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(' ').trim() : 'Vehicle';
}

/**
 * Logged travel that belongs to no vehicle row.
 *
 * `trip_records.vehicle_id` is nullable, and the RPC's month totals deliberately
 * include those trips while the per-vehicle rows necessarily cannot. So the
 * Travel total can legitimately exceed the sum of the By-vehicle rows, and
 * without accounting for the difference the page looks like it lost data.
 *
 * This is a SUBTRACTION of two figures the server already returned — not an
 * estimate and not an invented vehicle. Nothing is assigned to a vehicle that
 * the user did not assign it to; the trips are simply reported as unattributed.
 *
 * Only shown when it is non-zero, so a normal month with every trip on a vehicle
 * renders no extra row at all.
 */
export interface UnassignedTravel {
  tripCount: number;
  distanceKm: number;
}

export function unassignedLoggedTravel(analytics: BudgetAnalytics): UnassignedTravel {
  const assignedTrips = analytics.vehicles.reduce((sum, v) => sum + v.loggedTripCount, 0);
  const assignedKm = analytics.vehicles.reduce((sum, v) => sum + v.loggedDistanceKm, 0);
  return {
    // Clamped at 0: a negative would mean the rows exceeded the total, which
    // would indicate a server inconsistency rather than unassigned travel, and
    // rendering a negative count would be worse than rendering nothing.
    tripCount: Math.max(analytics.loggedTripCount - assignedTrips, 0),
    distanceKm: Math.max(analytics.loggedDistanceKm - assignedKm, 0),
  };
}

/**
 * How to describe a row's litres without ever implying a complete total.
 *
 * The distinction matters: a partial sum is a real measurement of part of the
 * month, so presenting it as the monthly figure would understate usage.
 */
export function describeLiters(row: VehicleBudgetRow): LitersCoverage {
  if (row.relevantRefillCount === 0) return { kind: 'none' };
  if (row.refillsWithLitersCount === 0) return { kind: 'none' };
  if (row.refillsWithLitersCount < row.relevantRefillCount) {
    return {
      kind: 'partial',
      known: row.refillsWithLitersCount,
      relevant: row.relevantRefillCount,
    };
  }
  return { kind: 'complete', liters: row.attributedLiters ?? 0 };
}

export class BudgetAnalyticsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetAnalyticsUnavailableError';
  }
}

