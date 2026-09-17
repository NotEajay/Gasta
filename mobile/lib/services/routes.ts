import { supabase } from '@/lib/supabase';

export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
}

export interface RouteCoordinate {
  latitude: number;
  longitude: number;
}

export type RouteLocation = string | RouteCoordinate;

interface RouteResponse {
  distanceKm?: unknown;
  durationMinutes?: unknown;
}

export async function fetchRoute(
  origin: RouteLocation,
  destination: RouteLocation
): Promise<RouteResult> {
  const validLocation = (location: RouteLocation) =>
    typeof location === 'string'
      ? Boolean(location.trim())
      : Number.isFinite(location.latitude) &&
        Number.isFinite(location.longitude) &&
        location.latitude >= -90 &&
        location.latitude <= 90 &&
        location.longitude >= -180 &&
        location.longitude <= 180;

  if (!validLocation(origin) || !validLocation(destination)) {
    throw new Error('Enter both an origin and destination before calculating a route.');
  }

  const { data, error } = await supabase.functions.invoke<RouteResponse>('compute-route', {
    body: { origin, destination },
  });

  if (error) {
    throw new Error(error.message || 'Route lookup failed.');
  }

  const distanceKm = data?.distanceKm;
  const durationMinutes = data?.durationMinutes;
  if (
    typeof distanceKm !== 'number' ||
    !Number.isFinite(distanceKm) ||
    distanceKm < 0 ||
    typeof durationMinutes !== 'number' ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 0
  ) {
    throw new Error('Route service returned an invalid result.');
  }

  return { distanceKm, durationMinutes };
}
