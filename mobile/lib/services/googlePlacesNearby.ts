import { supabase } from '@/lib/supabase';

export interface NearbyFuelStation {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
  distanceKm: number;
}

type NearbyResponse = { stations?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStation(value: unknown): NearbyFuelStation | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.placeId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.formattedAddress !== 'string' ||
    typeof value.latitude !== 'number' ||
    typeof value.longitude !== 'number'
  ) return null;
  return {
    placeId: value.placeId,
    name: value.name,
    formattedAddress: value.formattedAddress,
    latitude: value.latitude,
    longitude: value.longitude,
    distanceKm: 0,
    ...(typeof value.businessStatus === 'string' ? { businessStatus: value.businessStatus } : {}),
    ...(typeof value.rating === 'number' ? { rating: value.rating } : {}),
    ...(typeof value.userRatingCount === 'number' ? { userRatingCount: value.userRatingCount } : {}),
    ...(typeof value.openNow === 'boolean' ? { openNow: value.openNow } : {}),
  };
}

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const earthRadiusKm = 6371;
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLng = (b.longitude - a.longitude) * radians;
  const lat1 = a.latitude * radians;
  const lat2 = b.latitude * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function fetchNearbyFuelStations(
  latitude: number,
  longitude: number,
  radiusMeters = 5000,
): Promise<NearbyFuelStation[]> {
  const { data, error } = await supabase.functions.invoke<NearbyResponse>('google-places-nearby', {
    body: { latitude, longitude, radiusMeters },
  });
  if (error) throw error;
  if (!isRecord(data) || !Array.isArray(data.stations)) {
    throw new Error('Nearby station search returned an invalid response.');
  }
  return data.stations
    .map(normalizeStation)
    .filter((station): station is NearbyFuelStation => station !== null)
    .map((station) => ({
      ...station,
      distanceKm: haversineKm({ latitude, longitude }, station),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
