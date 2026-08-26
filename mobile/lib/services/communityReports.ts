import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { supabase } from '@/lib/supabase';

export interface FuelStationOption {
  id: string;
  name: string;
  address: string | null;
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
  fuel_type?: { code: string; name: string };
}

export interface PendingCommunityReport {
  id: string;
  reported_price: number;
  confirmation_count: number;
  status: string;
  created_at: string;
  notes: string | null;
  station: { name: string; region: { code: string } } | null;
  fuel_type: { code: string; name: string } | null;
}

async function resolveRegionId(regionCode: string): Promise<string> {
  const { data, error } = await supabase.from('regions').select('id').eq('code', regionCode).single();
  if (error) throw error;
  return data.id;
}

export async function fetchFuelStationsByRegion(regionCode: string): Promise<FuelStationOption[]> {
  const regionId = await resolveRegionId(regionCode);
  const { data, error } = await supabase
    .from('fuel_stations')
    .select(
      `
      id, name, address,
      oil_company:oil_companies ( id, name, slug ),
      region:regions ( id, code, name )
    `
    )
    .eq('region_id', regionId)
    .order('name');

  if (error) throw error;
  return (data ?? []) as unknown as FuelStationOption[];
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

  return rows;
}

export async function fetchPendingReports(limit = 20): Promise<PendingCommunityReport[]> {
  const { data, error } = await supabase
    .from('community_fuel_reports')
    .select(
      `
      id, reported_price, confirmation_count, status, created_at, notes,
      station:fuel_stations ( name, region:regions ( code ) ),
      fuel_type:fuel_types ( code, name )
    `
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as PendingCommunityReport[];
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
