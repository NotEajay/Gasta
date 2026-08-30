import { supabase } from '@/lib/supabase';
import type { FuelPriceBulletin } from '@/types';

export interface FuelPriceRow {
  id: string;
  price_per_liter: number;
  oil_company: { id: string; name: string; slug: string };
  fuel_type: { id: string; code: string; name: string };
  region: { id: string; code: string; name: string };
  bulletin: { id: string; bulletin_date: string };
}

async function resolveRegionId(regionCode: string): Promise<string> {
  const { data, error } = await supabase.from('regions').select('id').eq('code', regionCode).single();
  if (error) throw error;
  return data.id;
}

async function resolveFuelTypeId(fuelTypeCode: string): Promise<string> {
  const { data, error } = await supabase
    .from('fuel_types')
    .select('id')
    .eq('code', fuelTypeCode)
    .single();
  if (error) throw error;
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

/** Latest bulletin that actually has prices for a macro-region (DOE weeks differ by region). */
export async function fetchLatestBulletinForRegion(
  regionCode: string
): Promise<FuelPriceBulletin | null> {
  const regionId = await resolveRegionId(regionCode);
  const { data, error } = await supabase
    .from('fuel_price_bulletins')
    .select('*, fuel_prices!inner(region_id)')
    .eq('fuel_prices.region_id', regionId)
    .order('bulletin_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { fuel_prices: _ignored, ...bulletin } = data as FuelPriceBulletin & {
    fuel_prices: unknown;
  };
  return bulletin;
}

/** Distinct DOE bulletin weeks that have price rows for this region (oldest → newest). */
export async function fetchRegionBulletinWeeks(regionCode: string): Promise<string[]> {
  const bulletins = await fetchBulletinsForRegion(regionCode, 24);
  return [...bulletins].reverse().map((b) => b.bulletin_date);
}

/** Newest first. Bulletins that actually have prices for this region. */
export async function fetchBulletinsForRegion(
  regionCode: string,
  limit = 12
): Promise<FuelPriceBulletin[]> {
  const regionId = await resolveRegionId(regionCode);
  const { data, error } = await supabase
    .from('fuel_price_bulletins')
    .select('id, bulletin_date, source_pdf_url, notes, created_at, fuel_prices!inner(region_id)')
    .eq('fuel_prices.region_id', regionId)
    .order('bulletin_date', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const seen = new Set<string>();
  const bulletins: FuelPriceBulletin[] = [];
  for (const row of data ?? []) {
    const { fuel_prices: _ignored, ...bulletin } = row as FuelPriceBulletin & {
      fuel_prices: unknown;
    };
    if (!seen.has(bulletin.id)) {
      seen.add(bulletin.id);
      bulletins.push(bulletin);
    }
  }
  return bulletins;
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
  fuelTypeCode: string
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
      oil_company:oil_companies ( id, name, slug ),
      fuel_type:fuel_types ( id, code, name ),
      region:regions ( id, code, name ),
      bulletin:fuel_price_bulletins ( id, bulletin_date )
    `
    )
    .eq('bulletin_id', bulletinId)
    .eq('region_id', regionId)
    .eq('fuel_type_id', fuelTypeId)
    .order('price_per_liter', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as FuelPriceRow[];
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
    .eq('oil_company_id', company.id);

  if (error) throw error;

  type TrendRow = { price_per_liter: number; bulletin: { bulletin_date: string } | null };

  const rows = ((data ?? []) as unknown as TrendRow[])
    .map((row) => ({
      bulletin_date: row.bulletin?.bulletin_date ?? '',
      price_per_liter: row.price_per_liter,
    }))
    .filter((row) => row.bulletin_date);

  // One point per bulletin week for this region + company + fuel (newest last).
  const byWeek = new Map<string, number>();
  for (const row of rows) {
    byWeek.set(row.bulletin_date, row.price_per_liter);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bulletin_date, price_per_liter]) => ({ bulletin_date, price_per_liter }));
}

export async function fetchLowestPrice(
  regionCode: string,
  fuelTypeCode: string,
  bulletinId?: string
): Promise<FuelPriceRow | null> {
  const bulletin = bulletinId ? { id: bulletinId } : await fetchLatestBulletin();
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
