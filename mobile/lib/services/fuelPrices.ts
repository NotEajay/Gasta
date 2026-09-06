import { supabase } from '@/lib/supabase';
import type { FuelPriceBulletin } from '@/types';

export interface FuelPriceRow {
  id: string;
  price_per_liter: number;
  area_name: string;
  oil_company: { id: string; name: string; slug: string };
  fuel_type: { id: string; code: string; name: string };
  region: { id: string; code: string; name: string };
  bulletin: { id: string; bulletin_date: string };
}

/** One DOE bulletin week as it applies to a single region. */
export interface BulletinWeek {
  id: string;
  bulletin_date: string;
  price_count: number;
  data_freshness_days: number | null;
  last_loaded_at: string | null;
}

/** DOE publishes weekly, so prices older than this mean a sync has been missed. */
export const STALE_AFTER_DAYS = 10;

/** Calendar days since a bulletin week started. Negative = that week is still in the future. */
export function bulletinAgeInDays(bulletinDate: string, now = new Date()): number {
  const [year, month, day] = bulletinDate.split('-').map(Number);
  const published = new Date(year, (month || 1) - 1, day || 1);
  const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((midnightToday.getTime() - published.getTime()) / 86_400_000);
}

export function isBulletinStale(bulletinDate: string, now = new Date()): boolean {
  const age = bulletinAgeInDays(bulletinDate, now);
  // Future-dated rows (bad seed / bad parse) are never "fresh".
  return age < 0 || age > STALE_AFTER_DAYS;
}

const regionIdCache = new Map<string, string>();
const fuelTypeIdCache = new Map<string, string>();

async function resolveRegionId(regionCode: string): Promise<string> {
  const cached = regionIdCache.get(regionCode);
  if (cached) return cached;
  const { data, error } = await supabase.from('regions').select('id').eq('code', regionCode).single();
  if (error) throw error;
  regionIdCache.set(regionCode, data.id);
  return data.id;
}

async function resolveFuelTypeId(fuelTypeCode: string): Promise<string> {
  const cached = fuelTypeIdCache.get(fuelTypeCode);
  if (cached) return cached;
  const { data, error } = await supabase
    .from('fuel_types')
    .select('id')
    .eq('code', fuelTypeCode)
    .single();
  if (error) throw error;
  fuelTypeIdCache.set(fuelTypeCode, data.id);
  return data.id;
}

export async function fetchLatestBulletin(): Promise<FuelPriceBulletin | null> {
  const { data, error } = await supabase
    .from('fuel_price_bulletins')
    .select('*')
    .order('bulletin_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * DOE bulletin weeks that have prices for a region, newest first.
 *
 * Reads the `region_bulletin_weeks` view, which already collapses a region's price
 * rows down to one row per week — the app never needs to page through price rows
 * just to list which weeks exist.
 */
export async function fetchBulletinWeeksForRegion(
  regionCode: string,
  limit = 52
): Promise<BulletinWeek[]> {
  const today = new Date();
  const todayIso = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const { data, error } = await supabase
    .from('region_bulletin_weeks')
    .select('bulletin_id, bulletin_date, price_count, data_freshness_days, last_loaded_at')
    .eq('region_code', regionCode)
    // Future-dated rows (bad seed) must not become "this week".
    .lte('bulletin_date', todayIso)
    .order('bulletin_date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.bulletin_id,
    bulletin_date: row.bulletin_date,
    price_count: row.price_count,
    data_freshness_days: row.data_freshness_days,
    last_loaded_at: row.last_loaded_at,
  }));
}

/** Latest bulletin that actually has prices for a macro-region (DOE weeks differ by region). */
export async function fetchLatestBulletinForRegion(
  regionCode: string
): Promise<BulletinWeek | null> {
  const weeks = await fetchBulletinWeeksForRegion(regionCode, 1);
  return weeks[0] ?? null;
}

/** Newest first. Bulletins that actually have prices for this region. */
export async function fetchBulletinsForRegion(
  regionCode: string,
  limit = 52
): Promise<BulletinWeek[]> {
  return fetchBulletinWeeksForRegion(regionCode, limit);
}

/** Distinct DOE bulletin weeks that have price rows for this region (oldest → newest). */
export async function fetchRegionBulletinWeeks(regionCode: string): Promise<string[]> {
  const weeks = await fetchBulletinWeeksForRegion(regionCode);
  return [...weeks].reverse().map((week) => week.bulletin_date);
}

export async function fetchBulletins(limit = 8): Promise<FuelPriceBulletin[]> {
  const { data, error } = await supabase
    .from('fuel_price_bulletins')
    .select('*')
    .order('bulletin_date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function fetchFuelPricesForBulletin(
  bulletinId: string,
  regionCode: string,
  fuelTypeCode: string,
  areaName = ''
): Promise<FuelPriceRow[]> {
  const [regionId, fuelTypeId] = await Promise.all([
    resolveRegionId(regionCode),
    resolveFuelTypeId(fuelTypeCode),
  ]);

  const { data, error } = await supabase
    .from('fuel_prices')
    .select(
      `
      id,
      price_per_liter,
      area_name,
      oil_company:oil_companies ( id, name, slug ),
      fuel_type:fuel_types ( id, code, name ),
      region:regions ( id, code, name ),
      bulletin:fuel_price_bulletins ( id, bulletin_date )
    `
    )
    .eq('bulletin_id', bulletinId)
    .eq('region_id', regionId)
    .eq('fuel_type_id', fuelTypeId)
    .eq('area_name', areaName)
    .order('price_per_liter', { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as unknown as FuelPriceRow[];
  // Some regions (e.g. North Luzon) only have region-wide rows — fall back when
  // the selected city has no DOE AREA prices.
  if (rows.length === 0 && areaName) {
    return fetchFuelPricesForBulletin(bulletinId, regionCode, fuelTypeCode, '');
  }
  return rows;
}

/** Distinct city/area labels for a bulletin week in a region (excludes region-wide ''). */
export async function fetchBulletinAreas(
  bulletinId: string,
  regionCode: string
): Promise<string[]> {
  const regionId = await resolveRegionId(regionCode);
  const { data, error } = await supabase
    .from('fuel_prices')
    .select('area_name')
    .eq('bulletin_id', bulletinId)
    .eq('region_id', regionId)
    .neq('area_name', '')
    .order('area_name');

  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.area_name).filter(Boolean))];
}

export async function fetchPriceTrend(
  regionCode: string,
  fuelTypeCode: string,
  oilCompanySlug: string
): Promise<{ bulletin_date: string; price_per_liter: number }[]> {
  const [regionId, fuelTypeId] = await Promise.all([
    resolveRegionId(regionCode),
    resolveFuelTypeId(fuelTypeCode),
  ]);

  const { data: company, error: companyError } = await supabase
    .from('oil_companies')
    .select('id')
    .eq('slug', oilCompanySlug)
    .single();
  if (companyError) throw companyError;

  const { data, error } = await supabase
    .from('fuel_prices')
    .select(
      `
      price_per_liter,
      bulletin:fuel_price_bulletins ( bulletin_date )
    `
    )
    .eq('region_id', regionId)
    .eq('fuel_type_id', fuelTypeId)
    .eq('oil_company_id', company.id)
    .eq('area_name', '');

  if (error) throw error;

  type TrendRow = { price_per_liter: number; bulletin: { bulletin_date: string } | null };

  const today = new Date();
  const todayIso = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const rows = ((data ?? []) as unknown as TrendRow[])
    .map((row) => ({
      bulletin_date: row.bulletin?.bulletin_date ?? '',
      price_per_liter: row.price_per_liter,
    }))
    .filter((row) => row.bulletin_date && row.bulletin_date <= todayIso);

  // One point per bulletin week for this region + company + fuel (newest last).
  const byWeek = new Map<string, number>();
  for (const row of rows) {
    byWeek.set(row.bulletin_date, row.price_per_liter);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bulletin_date, price_per_liter]) => ({ bulletin_date, price_per_liter }));
}

/** Cheapest brand for a region in its most recent DOE week. */
export async function fetchLowestPrice(
  regionCode: string,
  fuelTypeCode: string,
  bulletinId?: string
): Promise<FuelPriceRow | null> {
  const bulletin = bulletinId
    ? { id: bulletinId }
    : await fetchLatestBulletinForRegion(regionCode);
  if (!bulletin) return null;

  const prices = await fetchFuelPricesForBulletin(bulletin.id, regionCode, fuelTypeCode);
  return prices[0] ?? null;
}

export async function fetchFuelPriceByRegionAndType(
  regionCode: string,
  fuelTypeCode: string
): Promise<number | null> {
  const lowest = await fetchLowestPrice(regionCode, fuelTypeCode);
  return lowest?.price_per_liter ?? null;
}
