import type { DoeFuelTypeCode } from '@/constants/fuelTypes';
import type { DoeRegionCode } from '@/constants/regions';
import {
  fetchFuelPricesForBulletin,
  fetchLatestBulletinForRegion,
  type FuelPriceRow,
} from '@/lib/services/fuelPrices';
import type { NearbyFuelStation } from '@/lib/services/googlePlacesNearby';
import { fetchFreshVerifiedPrices, type VerifiedCommunityPrice } from '@/lib/services/communityReports';
import { supabase } from '@/lib/supabase';

export type StationPriceSource =
  | 'verified_community_station'
  | 'doe_area_brand'
  | 'doe_region_brand'
  | 'unavailable';

export type StationPriceLabel =
  | 'Verified community price'
  | 'DOE area/brand estimate'
  | 'DOE region-wide estimate'
  | 'Exact branch price unavailable';

export interface StationRecommendation {
  station: NearbyFuelStation;
  normalizedBrand?: string;
  pricePerLiter?: number;
  priceSource: StationPriceSource;
  priceLabel: StationPriceLabel;
}

const BRAND_ALIASES: Record<string, { label: string; slug: string; aliases: string[] }> = {
  petron: { label: 'Petron', slug: 'petron', aliases: ['petron'] },
  shell: { label: 'Shell', slug: 'shell', aliases: ['shell'] },
  caltex: { label: 'Caltex', slug: 'caltex', aliases: ['caltex'] },
  phoenix: { label: 'Phoenix', slug: 'phoenix', aliases: ['phoenix'] },
  total: { label: 'TotalEnergies', slug: 'total', aliases: ['total', 'totalenergies'] },
  flying_v: { label: 'Flying V', slug: 'flying-v', aliases: ['flying v', 'flying-v'] },
  unioil: { label: 'UniOil', slug: 'unioil', aliases: ['unioil', 'uni oil'] },
  seaoil: { label: 'Seaoil', slug: 'seaoil', aliases: ['seaoil', 'sea oil'] },
  ptt: { label: 'PTT', slug: 'ptt', aliases: ['ptt'] },
  cleanfuel: { label: 'Cleanfuel', slug: 'cleanfuel', aliases: ['cleanfuel', 'clean fuel'] },
  mygas: { label: 'MyGas', slug: 'mygas', aliases: ['mygas', 'my gas'] },
  jetti: { label: 'Jetti', slug: 'jetti', aliases: ['jetti'] },
};

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Returns a brand only when an explicit, bounded alias occurs in the station
 * name. Similar-looking names remain unmatched rather than being guessed.
 */
export function normalizeGoogleStationBrand(name: string): { label: string; slug: string } | null {
  const value = ` ${normalizedText(name)} `;
  for (const brand of Object.values(BRAND_ALIASES)) {
    if (brand.aliases.some((alias) => value.includes(` ${normalizedText(alias)} `))) {
      return { label: brand.label, slug: brand.slug };
    }
  }
  return null;
}

const DOE_CODE_BY_FUEL_TYPE: Record<string, DoeFuelTypeCode> = {
  RON_91: 'RON_91',
  RON_95: 'RON_95',
  RON_97: 'RON_97',
  RON_100: 'RON_100',
  DIESEL: 'DIESEL',
  DIESEL_PLUS: 'DIESEL_PLUS',
  KEROSENE: 'KEROSENE',
};

async function resolveFuelCode(fuelTypeId: string): Promise<DoeFuelTypeCode | null> {
  const { data, error } = await supabase
    .from('fuel_types')
    .select('code')
    .eq('id', fuelTypeId)
    .maybeSingle();
  if (error) throw error;
  return data?.code ? DOE_CODE_BY_FUEL_TYPE[data.code] ?? null : null;
}

function lowestBrandPrice(rows: FuelPriceRow[], slug: string): number | undefined {
  const prices = rows
    .filter((row) => row.oil_company.slug === slug)
    .map((row) => row.price_per_liter)
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : undefined;
}

function normalizedStationName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function coordinatesAreClose(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number }
): boolean {
  const latitudeDelta = Math.abs(first.latitude - second.latitude);
  const longitudeDelta = Math.abs(first.longitude - second.longitude);
  return latitudeDelta <= 0.0005 && longitudeDelta <= 0.0005;
}

type StationIdentity = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  google_place_id: string | null;
};

async function fetchStationIdentities(regionCode: DoeRegionCode): Promise<StationIdentity[]> {
  const { data: region, error: regionError } = await supabase
    .from('regions')
    .select('id')
    .eq('code', regionCode)
    .single();
  if (regionError) throw regionError;
  const { data, error } = await supabase
    .from('fuel_stations')
    .select('id, name, latitude, longitude, google_place_id')
    .eq('region_id', region.id);
  if (error) throw error;
  return (data ?? []) as unknown as StationIdentity[];
}

function matchStationIdentity(
  station: NearbyFuelStation,
  identities: StationIdentity[]
): StationIdentity | null {
  const exact = identities.find((candidate) => candidate.google_place_id === station.placeId);
  if (exact) return exact;
  const stationName = normalizedStationName(station.name);
  return identities.find(
    (candidate) =>
      !candidate.google_place_id &&
      normalizedStationName(candidate.name) === stationName &&
      coordinatesAreClose(station, {
        latitude: Number(candidate.latitude),
        longitude: Number(candidate.longitude),
      })
  ) ?? null;
}

function communityPricesByStation(
  prices: VerifiedCommunityPrice[],
  stationIdentities: StationIdentity[],
): Map<string, number> {
  const pricesByStation = new Map<string, number>();
  for (const price of prices) {
    const identity = stationIdentities.find((candidate) => candidate.id === price.station_id);
    if (
      identity &&
      Number.isFinite(price.reported_price) &&
      price.reported_price > 0 &&
      !pricesByStation.has(identity.id)
    ) {
      pricesByStation.set(identity.id, price.reported_price);
    }
  }
  return pricesByStation;
}

function enrichStation(
  station: NearbyFuelStation,
  communityPrice: number | undefined,
  areaRows: FuelPriceRow[],
  regionRows: FuelPriceRow[],
): StationRecommendation {
  if (communityPrice !== undefined) {
    return {
      station,
      pricePerLiter: communityPrice,
      priceSource: 'verified_community_station',
      priceLabel: 'Verified community price',
    };
  }
  const brand = normalizeGoogleStationBrand(station.name);
  if (!brand) {
    return {
      station,
      priceSource: 'unavailable',
      priceLabel: 'Exact branch price unavailable',
    };
  }
  const areaPrice = lowestBrandPrice(areaRows, brand.slug);
  if (areaPrice !== undefined) {
    return {
      station,
      normalizedBrand: brand.label,
      pricePerLiter: areaPrice,
      priceSource: 'doe_area_brand',
      priceLabel: 'DOE area/brand estimate',
    };
  }
  const regionPrice = lowestBrandPrice(regionRows, brand.slug);
  if (regionPrice !== undefined) {
    return {
      station,
      normalizedBrand: brand.label,
      pricePerLiter: regionPrice,
      priceSource: 'doe_region_brand',
      priceLabel: 'DOE region-wide estimate',
    };
  }
  return {
    station,
    normalizedBrand: brand.label,
    priceSource: 'unavailable',
    priceLabel: 'Exact branch price unavailable',
  };
}

export async function enrichNearbyStations(input: {
  stations: NearbyFuelStation[];
  regionCode: DoeRegionCode | null;
  fuelTypeId: string | null | undefined;
  areaName?: string | null;
}): Promise<StationRecommendation[]> {
  if (!input.regionCode || !input.fuelTypeId || input.stations.length === 0) {
    return input.stations.map((station) => ({
      station,
      priceSource: 'unavailable',
      priceLabel: 'Exact branch price unavailable',
    }));
  }
  const fuelCode = await resolveFuelCode(input.fuelTypeId);
  const bulletin = await fetchLatestBulletinForRegion(input.regionCode);
  const [stationIdentities, verifiedPrices] = await Promise.all([
    fetchStationIdentities(input.regionCode),
    fuelCode
      ? fetchFreshVerifiedPrices(input.regionCode, fuelCode)
      : Promise.resolve([] as VerifiedCommunityPrice[]),
  ]);
  const matchedStations = new Map(
    input.stations.map((station) => [station.placeId, matchStationIdentity(station, stationIdentities)])
  );
  const pricesByStation = communityPricesByStation(verifiedPrices, stationIdentities);
  if (!fuelCode || !bulletin) {
    return input.stations.map((station) => ({
      station,
      priceSource: 'unavailable',
      priceLabel: 'Exact branch price unavailable',
    }));
  }

  const areaName = input.areaName ?? '';
  const [areaRows, regionRows] = await Promise.all([
    areaName
      ? fetchFuelPricesForBulletin(bulletin.id, input.regionCode, fuelCode, areaName)
      : Promise.resolve([]),
    fetchFuelPricesForBulletin(bulletin.id, input.regionCode, fuelCode, ''),
  ]);

  return input.stations
    .map((station) => {
      const matched = matchedStations.get(station.placeId);
      return enrichStation(
        station,
        matched ? pricesByStation.get(matched.id) : undefined,
        areaRows,
        regionRows
      );
    })
    .sort((a, b) => {
      const sourceRank: Record<StationPriceSource, number> = {
        verified_community_station: 0,
        doe_area_brand: 1,
        doe_region_brand: 2,
        unavailable: 3,
      };
      const rankDifference = sourceRank[a.priceSource] - sourceRank[b.priceSource];
      if (rankDifference !== 0) return rankDifference;
      const aPrice = a.pricePerLiter;
      const bPrice = b.pricePerLiter;
      if (aPrice === undefined && bPrice !== undefined) return 1;
      if (aPrice !== undefined && bPrice === undefined) return -1;
      if (aPrice !== undefined && bPrice !== undefined && aPrice !== bPrice) {
        return aPrice - bPrice;
      }
      return a.station.distanceKm - b.station.distanceKm;
    });
}
