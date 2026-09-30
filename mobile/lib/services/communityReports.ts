import type { SupabaseClient } from '@supabase/supabase-js';

import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { supabase } from '@/lib/supabase';

/**
 * Narrow client that types the one table the generated `Database` does not know.
 *
 * `community_fuel_report_confirmations` is created in migration
 * 20240812000005_community_fuel_stations.sql and has been queried from here
 * all along, but `types/database.ts` predates it, so `.from(...)` rejects the
 * table name and the `.eq('user_id', ...)` chain fails to resolve.
 *
 * Only the two columns this file reads are declared. This follows the same
 * adapter pattern already used in refillAllocations.ts, vehicleRefills.ts and
 * lib/profile.ts for the other not-yet-generated objects: type exactly what is
 * called, rather than casting the result to `any` or editing the generated file
 * or the database. Delete once `supabase gen types` has been re-run.
 */
interface ConfirmationDatabase {
  public: {
    Tables: {
      community_fuel_report_confirmations: {
        Row: { id: string; report_id: string; user_id: string; observed_price: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const confirmationDb = supabase as unknown as SupabaseClient<ConfirmationDatabase>;

export interface FuelStationOption {
  id: string;
  name: string;
  address: string | null;
  brand_label: string | null;
  oil_company: { id: string; name: string; slug: string };
  region: { id: string; code: string; name: string };
}

export interface VerifiedCommunityPrice {
  report_id: string;
  station_id: string;
  fuel_type_id: string;
  reported_price: number;
  verified_at: string;
  station_name: string;
  oil_company_id: string;
  region_id: string;
  address: string | null;
  confirmation_count: number;
  fuel_type?: { code: string; name: string };
}

export interface PendingCommunityReport {
  id: string;
  reported_price: number;
  confirmation_count: number;
  status: string;
  created_at: string;
  notes: string | null;
  reported_by: string;
  station: { name: string; region: { code: string } } | null;
  fuel_type: { code: string; name: string } | null;
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function resolveRegionId(regionCode: string): Promise<string> {
  const { data, error } = await supabase.from('regions').select('id').eq('code', regionCode).single();
  if (error) throw error;
  return data.id;
}

export async function fetchFuelStationsByRegion(regionCode: string): Promise<FuelStationOption[]> {
  const regionId = await resolveRegionId(regionCode);
  const selectWithBrand = `
      id, name, address, brand_label,
      oil_company:oil_companies ( id, name, slug ),
      region:regions ( id, code, name )
    `;
  const selectBasic = `
      id, name, address,
      oil_company:oil_companies ( id, name, slug ),
      region:regions ( id, code, name )
    `;

  /*
   * Raw shape of a station row as it comes back from PostgREST.
   *
   * Declared locally because the generated `Database` type predates the
   * `fuel_stations.brand_label` column (added in migration 007) and does not
   * model the embedded `oil_company` / `region` relations, so supabase-js
   * infers a `SelectQueryError` union for them. Both selects below therefore
   * normalise into this one row type rather than into two incompatible
   * inferred shapes -- the retry path used to fail to typecheck precisely
   * because it assigned a differently-inferred result onto `data`.
   *
   * `brand_label` is genuinely nullable: custom brands store their name there,
   * so the first select can legitimately return it and the fallback one cannot
   * ask for it at all.
   */
  type StationRow = {
    id: string;
    name: string;
    address: string | null;
    brand_label?: string | null;
    oil_company: { id: string; name: string; slug: string } | null;
    region: { id: string; code: string; name: string } | null;
  };

  let rows: StationRow[] = [];
  const first = await supabase
    .from('fuel_stations')
    .select(selectWithBrand)
    .eq('region_id', regionId)
    .order('name');

  if (!first.error) {
    rows = (first.data ?? []) as unknown as StationRow[];
  } else {
    // Older deployments have no brand_label column. Retry without it; the row
    // shape is identical, which is why both branches share one type.
    const retry = await supabase
      .from('fuel_stations')
      .select(selectBasic)
      .eq('region_id', regionId)
      .order('name');
    if (retry.error) throw retry.error;
    rows = (retry.data ?? []) as unknown as StationRow[];
  }

  return rows.map((row) => ({
    ...row,
    brand_label: row.brand_label ?? null,
  })) as FuelStationOption[];
}

export async function findOilCompanyByName(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from('oil_companies')
    .select('id')
    .ilike('name', trimmed)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return existingId(data);
}

function existingId(row: { id: string } | null): string | null {
  return row?.id ?? null;
}

export async function getIndependentCompanyId(): Promise<string> {
  const { data, error } = await supabase
    .from('oil_companies')
    .select('id')
    .eq('slug', 'independent')
    .maybeSingle();
  if (error) throw error;
  if (data?.id) return data.id;

  const { data: byName } = await supabase
    .from('oil_companies')
    .select('id')
    .ilike('name', 'Independent')
    .limit(1)
    .maybeSingle();
  if (byName?.id) return byName.id;

  throw new Error('Independent station type is not set up. Run migration 007 in Supabase.');
}

export async function fetchOilCompanies(): Promise<{ id: string; name: string; slug: string }[]> {
  const { data, error } = await supabase
    .from('oil_companies')
    .select('id, name, slug')
    .neq('slug', 'independent')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createFuelStation(input: {
  name: string;
  oilCompanyId: string;
  regionCode: string;
  latitude: number;
  longitude: number;
  address?: string;
  brandLabel?: string | null;
}): Promise<string> {
  const regionId = await resolveRegionId(input.regionCode);
  const { data, error } = await supabase.rpc('create_fuel_station', {
    p_name: input.name,
    p_oil_company_id: input.oilCompanyId,
    p_region_id: regionId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_address: input.address ?? null,
    p_brand_label: input.brandLabel ?? null,
  });
  if (!error) {
    return data as string;
  }

  const fallback = await supabase.rpc('create_fuel_station', {
    p_name: input.name,
    p_oil_company_id: input.oilCompanyId,
    p_region_id: regionId,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_address: input.address ?? null,
  });
  if (fallback.error) throw error;
  return fallback.data as string;
}

export async function fetchFreshVerifiedPrices(
  regionCode?: string,
  fuelTypeCode?: string
): Promise<VerifiedCommunityPrice[]> {
  let query = supabase.from('fresh_verified_community_prices').select('*');

  if (regionCode) {
    const regionId = await resolveRegionId(regionCode);
    query = query.eq('region_id', regionId);
  }

  const { data, error } = await query.order('verified_at', { ascending: false });
  if (error) throw error;

  let rows = (data ?? []) as VerifiedCommunityPrice[];

  if (fuelTypeCode) {
    const { data: fuelType, error: fuelError } = await supabase
      .from('fuel_types')
      .select('id')
      .eq('code', fuelTypeCode)
      .single();
    if (fuelError) throw fuelError;
    rows = rows.filter((r) => r.fuel_type_id === fuelType.id);
  }

  const reportIds = rows.map((r) => r.report_id);
  if (reportIds.length > 0) {
    const { data: counts, error: countError } = await supabase
      .from('community_fuel_reports')
      .select('id, confirmation_count')
      .in('id', reportIds);
    if (!countError) {
      const byId = new Map((counts ?? []).map((row) => [row.id, row.confirmation_count]));
      rows = rows.map((row) => ({
        ...row,
        confirmation_count: byId.get(row.report_id) ?? VERIFY_CONFIRMATIONS_REQUIRED,
      }));
    }
  }

  return rows;
}

export async function fetchPendingReports(
  limit = 50,
  filters?: { regionCode?: string; fuelTypeCode?: string }
): Promise<PendingCommunityReport[]> {
  // Prefer a single embedded query so RLS + region filter stay consistent.
  let query = supabase
    .from('community_fuel_reports')
    .select(
      `
      id,
      reported_price,
      confirmation_count,
      status,
      created_at,
      notes,
      reported_by,
      station_id,
      fuel_type_id,
      station:fuel_stations!inner (
        name,
        region_id,
        region:regions!inner ( code )
      ),
      fuel_type:fuel_types ( code, name )
    `
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filters?.regionCode) {
    query = query.eq('station.region.code', filters.regionCode);
  }

  if (filters?.fuelTypeCode) {
    query = query.eq('fuel_type.code', filters.fuelTypeCode);
  }

  const { data, error } = await query;
  if (error) {
    // Fallback without embeds if the relationship filter is unsupported
    return fetchPendingReportsFallback(limit, filters);
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    reported_price: number;
    confirmation_count: number;
    status: string;
    created_at: string;
    notes: string | null;
    reported_by: string;
    station:
      | { name: string; region: { code: string } | { code: string }[] | null }
      | { name: string; region: { code: string } | { code: string }[] | null }[]
      | null;
    fuel_type: { code: string; name: string } | { code: string; name: string }[] | null;
  }>).map((row) => {
    const station = unwrapOne(row.station);
    const region = station ? unwrapOne(station.region) : null;
    const fuelType = unwrapOne(row.fuel_type);
    return {
      id: row.id,
      reported_price: row.reported_price,
      confirmation_count: row.confirmation_count,
      status: row.status,
      created_at: row.created_at,
      notes: row.notes,
      reported_by: row.reported_by,
      station: station
        ? { name: station.name, region: { code: region?.code ?? '' } }
        : null,
      fuel_type: fuelType ? { code: fuelType.code, name: fuelType.name } : null,
    };
  });
}

async function fetchPendingReportsFallback(
  limit = 50,
  filters?: { regionCode?: string; fuelTypeCode?: string }
): Promise<PendingCommunityReport[]> {
  let stationIds: string[] | null = null;
  if (filters?.regionCode) {
    const regionId = await resolveRegionId(filters.regionCode);
    const { data: stations, error: stationError } = await supabase
      .from('fuel_stations')
      .select('id')
      .eq('region_id', regionId);
    if (stationError) throw stationError;
    stationIds = (stations ?? []).map((s) => s.id);
    if (stationIds.length === 0) return [];
  }

  let fuelTypeId: string | null = null;
  if (filters?.fuelTypeCode) {
    const { data: fuelType, error: fuelError } = await supabase
      .from('fuel_types')
      .select('id')
      .eq('code', filters.fuelTypeCode)
      .single();
    if (fuelError) throw fuelError;
    fuelTypeId = fuelType.id;
  }

  let query = supabase
    .from('community_fuel_reports')
    .select(
      'id, reported_price, confirmation_count, status, created_at, notes, reported_by, station_id, fuel_type_id'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (stationIds) query = query.in('station_id', stationIds);
  if (fuelTypeId) query = query.eq('fuel_type_id', fuelTypeId);

  const { data: reports, error } = await query;
  if (error) throw error;
  const rows = reports ?? [];
  if (rows.length === 0) return [];

  const reportStationIds = [...new Set(rows.map((r) => r.station_id))];
  const fuelTypeIds = [...new Set(rows.map((r) => r.fuel_type_id))];

  const [stationsRes, fuelTypesRes] = await Promise.all([
    supabase
      .from('fuel_stations')
      .select('id, name, region:regions ( code )')
      .in('id', reportStationIds),
    supabase.from('fuel_types').select('id, code, name').in('id', fuelTypeIds),
  ]);

  if (stationsRes.error) throw stationsRes.error;
  if (fuelTypesRes.error) throw fuelTypesRes.error;

  // Narrow raw row for the embedded relation below. The generated `Database`
  // type does not model `fuel_stations -> regions`, so supabase-js infers a
  // SelectQueryError for `station.region`; `unwrapOne` then cannot accept it.
  // Casting once at the query boundary keeps the mapping below honest: PostgREST
  // returns either a single embedded object or a one-element array depending on
  // whether the embed was treated as a to-one or to-many, and `unwrapOne`
  // handles both.
  type StationWithRegionRow = {
    id: string;
    name: string;
    region: unknown;
  };

  const stationsById = new Map(
    ((stationsRes.data ?? []) as unknown as StationWithRegionRow[]).map((station) => {
      const region = unwrapOne(station.region as { code: string } | { code: string }[] | null);
      return [
        station.id,
        { name: station.name, region: region ? { code: region.code } : { code: '' } },
      ];
    })
  );
  const fuelById = new Map(
    (fuelTypesRes.data ?? []).map((ft) => [ft.id, { code: ft.code, name: ft.name }])
  );

  return rows.map((row) => ({
    id: row.id,
    reported_price: row.reported_price,
    confirmation_count: row.confirmation_count,
    status: row.status,
    created_at: row.created_at,
    notes: row.notes,
    reported_by: row.reported_by,
    station: stationsById.get(row.station_id) ?? null,
    fuel_type: fuelById.get(row.fuel_type_id) ?? null,
  }));
}

export async function fetchConfirmedReportIds(
  userId: string,
  reportIds: string[]
): Promise<Set<string>> {
  if (reportIds.length === 0) return new Set();
  // Same table, same columns, same filters, same error handling -- only the
  // client differs, because the generated types do not know this table.
  const { data, error } = await confirmationDb
    .from('community_fuel_report_confirmations')
    .select('report_id')
    .eq('user_id', userId)
    .in('report_id', reportIds);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.report_id));
}

export async function submitCommunityReport(input: {
  stationId: string;
  fuelTypeId: string;
  price: number;
  notes?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('submit_community_fuel_report', {
    p_station_id: input.stationId,
    p_fuel_type_id: input.fuelTypeId,
    p_reported_price: input.price,
    p_notes: input.notes ?? null,
  });

  if (error) throw error;
  return data as string;
}

export async function confirmCommunityReport(reportId: string, observedPrice?: number): Promise<void> {
  const { error } = await supabase.rpc('confirm_community_fuel_report', {
    p_report_id: reportId,
    p_observed_price: observedPrice ?? null,
  });
  if (error) throw error;
}

/**
 * Reports submitted by the signed-in user, newest first.
 *
 * No extra RLS is needed to read these: `community_fuel_reports_select_pending`
 * already exposes every pending report, and `..._select_own_private` exposes the
 * author's own `rejected` / `needs_review` rows. Verified rows are readable only
 * while they are still fresh (7 days) or already public, so an older verified
 * report of the user's simply does not come back -- that is the correct
 * behaviour, not a bug, and it is why the UI only offers deletion for `pending`.
 */
export async function fetchMyCommunityReports(userId: string): Promise<PendingCommunityReport[]> {
  let query = supabase
    .from('community_fuel_reports')
    .select(
      `
      id,
      reported_price,
      confirmation_count,
      status,
      created_at,
      notes,
      reported_by,
      station_id,
      fuel_type_id,
      station:fuel_stations!inner (
        name,
        region_id,
        region:regions!inner ( code )
      ),
      fuel_type:fuel_types ( code, name )
    `
    )
    .eq('reported_by', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as PendingCommunityReport[];
  return rows.map((row) => ({
    ...row,
    reported_price: Number(row.reported_price),
  }));
}

/**
 * Withdraw one of your own pending reports.
 *
 * Ownership is enforced in the database by `delete_community_fuel_report`, a
 * SECURITY DEFINER function that re-checks `reported_by = auth.uid()` and
 * `status = 'pending'` before deleting. RLS has no DELETE policy on
 * `community_fuel_reports`, so a raw client-side `.delete()` is refused by
 * Postgres for every user, including the author -- the RPC is the only path.
 *
 * That is why this function takes no `userId`: there is no client-side filter to
 * apply, and passing the id through would only look like a security check while
 * the database silently did the real one. Verified reports are intentionally
 * not deletable -- they are promoted automatically at 3 confirmations and feed
 * `fresh_verified_community_prices`, which other users' station prices read from.
 */
export async function deleteCommunityReport(reportId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_community_fuel_report', {
    p_report_id: reportId,
  });
  if (error) throw error;
}

/** Mirrors the DB rule: only `pending` reports can be withdrawn. */
export function canDeleteCommunityReport(status: string): boolean {
  return status === 'pending';
}

export function confirmationsLabel(count: number): string {
  return `${count}/${VERIFY_CONFIRMATIONS_REQUIRED} confirmations`;
}

export function usersConfirmedLabel(count: number): string {
  return count === 1 ? '1 user confirmed' : `${count} users confirmed`;
}
