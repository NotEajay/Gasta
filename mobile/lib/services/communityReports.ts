import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { supabase } from '@/lib/supabase';

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

  let { data, error } = await supabase
    .from('fuel_stations')
    .select(selectWithBrand)
    .eq('region_id', regionId)
    .order('name');

  if (error) {
    const retry = await supabase
      .from('fuel_stations')
      .select(selectBasic)
      .eq('region_id', regionId)
      .order('name');
    if (retry.error) throw retry.error;
    data = retry.data;
  }

  return ((data ?? []) as unknown as FuelStationOption[]).map((row) => ({
    ...row,
    brand_label: row.brand_label ?? null,
  }));
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

  const stationsById = new Map(
    (stationsRes.data ?? []).map((station) => {
      const region = unwrapOne(station.region as { code: string } | { code: string }[] | null);
      return [
        station.id,
        { name: station.name as string, region: region ? { code: region.code } : { code: '' } },
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
  const { data, error } = await supabase
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

export function confirmationsLabel(count: number): string {
  return `${count}/${VERIFY_CONFIRMATIONS_REQUIRED} confirmations`;
}

export function usersConfirmedLabel(count: number): string {
  return count === 1 ? '1 user confirmed' : `${count} users confirmed`;
}
