import * as Location from 'expo-location';

import { DOE_REGIONS, REGION_CENTROIDS, type DoeRegionCode } from '@/constants/regions';

/**
 * Foreground location, shared by Prices and Trip.
 *
 * Reuses `expo-location`, which the app already ships and already uses in
 * /trip/pick-map. No second geolocation library is introduced, and nothing here
 * is background location, continuous tracking, geofencing or a location store --
 * there is no Supabase write anywhere in this file.
 *
 * Everything is opt-in and cached for the session. Permission is never
 * required: a refusal leaves the app exactly as usable as before, and the user
 * can retry later from a `Near me` control rather than being nagged.
 */

export type LocationPermissionState = 'granted' | 'denied' | 'undetermined';

export interface ResolvedPlace {
  latitude: number;
  longitude: number;
  /** Nearest DOE pricing area, from coordinates alone. */
  regionCode: DoeRegionCode;
  /**
   * Best-effort city / municipality, from reverse geocoding.
   *
   * `null` when geocoding is unavailable. Callers must treat this as optional
   * and degrade to region-only rather than failing.
   */
  city: string | null;
}

const PERMISSION_COPY = 'Use your location to show fuel prices near your area.';

/** Session cache so a re-render or tab switch never re-asks the GPS. */
let cachedPlace: ResolvedPlace | null = null;
let cachedPermission: LocationPermissionState | null = null;
let inFlight: Promise<ResolvedPlace | null> | null = null;

export function clearLocationCache(): void {
  cachedPlace = null;
  cachedPermission = null;
  inFlight = null;
}

export function getCachedLocation(): ResolvedPlace | null {
  return cachedPlace;
}

/** The explanation shown alongside the OS prompt. */
export const LOCATION_PERMISSION_REASON = PERMISSION_COPY;

function mapPermission(status: Location.PermissionStatus): LocationPermissionState {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

/**
 * Nearest DOE pricing area from coordinates.
 *
 * Reuses the same REGION_CENTROIDS the rest of the app already trusts, so no
 * new geography is introduced. This is a FALLBACK: a reverse-geocoded city is
 * preferred when available, because a centroid is a coarse point and pricing
 * area borders do not follow it exactly.
 */
export function regionFromCoordinates(
  latitude: number,
  longitude: number
): DoeRegionCode {
  let best: DoeRegionCode = 'NCR';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const region of DOE_REGIONS) {
    const centroid = REGION_CENTROIDS[region.code];
    const dLat = latitude - centroid.latitude;
    const dLng = (longitude - centroid.longitude) * Math.cos((latitude * Math.PI) / 180);
    const distance = dLat * dLat + dLng * dLng;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region.code;
    }
  }
  return best;
}

/**
 * Reverse geocode to a city / municipality name.
 *
 * Platform geocoder only. Any failure returns null -- the caller carries on with
 * the region it already has, because a missing city name must never take the
 * Prices screen down.
 */
async function reverseGeocodeCity(
  latitude: number,
  longitude: number
): Promise<string | null> {
  try {
    const places = await Location.reverseGeocodeAsync({ latitude, longitude });
    const place = places?.[0];
    const city = place?.city ?? place?.subregion ?? place?.district ?? null;
    return city ? city.trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Reverse geocode coordinates to a city / municipality name.
 *
 * Exposed separately from `resolveCurrentPlace` so a screen that already HAS
 * coordinates -- because its map picker returned an origin, for instance -- can
 * resolve a city without ever asking the OS for a GPS fix it does not need.
 *
 * Platform geocoder only. Any failure returns null; callers must degrade to
 * region-only rather than failing.
 */
export async function reverseGeocodeCityOnly(
  latitude: number,
  longitude: number
): Promise<string | null> {
  return reverseGeocodeCity(latitude, longitude);
}

/**
 * Resolve the user's current place, asking for permission if needed.
 *
 * `requestIfNeeded: false` is the non-nagging path used on first paint: it reads
 * the existing grant without prompting. A `Near me` tap passes `true` to
 * actively request.
 */
export async function resolveCurrentPlace(options?: {
  requestIfNeeded?: boolean;
  force?: boolean;
}): Promise<ResolvedPlace | null> {
  const requestIfNeeded = options?.requestIfNeeded ?? false;
  const force = options?.force ?? false;

  if (!force && cachedPlace) return cachedPlace;
  // Collapse concurrent callers onto one GPS request.
  if (!force && inFlight) return inFlight;

  const run = (async (): Promise<ResolvedPlace | null> => {
    try {
      let status = await Location.getForegroundPermissionsAsync();
      if (status.status !== Location.PermissionStatus.GRANTED) {
        if (!requestIfNeeded) {
          cachedPermission = mapPermission(status.status);
          return null;
        }
        status = await Location.requestForegroundPermissionsAsync();
      }

      cachedPermission = mapPermission(status.status);
      if (status.status !== Location.PermissionStatus.GRANTED) return null;

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      const city = await reverseGeocodeCity(latitude, longitude);
      cachedPlace = {
        latitude,
        longitude,
        regionCode: regionFromCoordinates(latitude, longitude),
        city,
      };
      return cachedPlace;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  inFlight = run;
  return run;
}

export function getLocationPermissionState(): LocationPermissionState | null {
  return cachedPermission;
}

/**
 * Match a free-text city against the area names a bulletin actually publishes.
 *
 * Bulletin areas are real DOE strings such as "Naga City", so matching is
 * normalised case/whitespace and suffix-insensitive. It NEVER invents an area:
 * when nothing matches it returns null and the caller keeps Region + "All
 * areas".
 */
export function matchBulletinArea(city: string | null, areas: string[]): string | null {
  if (!city) return null;
  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const target = normalise(city);
  if (!target) return null;

  // Drop the generic suffix so "Naga City" also matches a bare "Naga" row.
  const stem = target.replace(/\s+(city|municipality|province)$/i, '').trim();

  for (const area of areas) {
    const candidate = normalise(area);
    if (!candidate) continue;
    const candidateStem = candidate
      .replace(/\s+(city|municipality|province)$/i, '')
      .trim();
    if (candidate === target || candidateStem === stem) return area;
    if (candidate.includes(target) || target.includes(candidate)) return area;
    if (stem && (candidateStem.includes(stem) || stem.includes(candidateStem))) return area;
  }
  return null;
}
