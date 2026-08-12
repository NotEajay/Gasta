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
    .eq('oil_company_id', company.id)
    .order('bulletin(bulletin_date)', { ascending: true });

  if (error) throw error;

  type TrendRow = { price_per_liter: number; bulletin: { bulletin_date: string } | null };

  return ((data ?? []) as TrendRow[]).map((row) => ({
    bulletin_date: row.bulletin?.bulletin_date ?? '',
    price_per_liter: row.price_per_liter,
  })).filter((row) => row.bulletin_date);
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
