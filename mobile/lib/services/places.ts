import { supabase } from '@/lib/supabase';
import type { RouteCoordinate } from '@/lib/services/routes';

export interface PlaceSearchResult {
  id: string;
  name: string;
  address: string;
  coordinate: RouteCoordinate;
}

interface PlaceSearchResponse {
  places?: unknown;
}

function isPlaceSearchResult(value: unknown): value is PlaceSearchResult {
  if (!value || typeof value !== 'object') return false;
  const place = value as Record<string, unknown>;
  const coordinate = place.coordinate;
  if (!coordinate || typeof coordinate !== 'object') return false;
  const point = coordinate as Record<string, unknown>;
  return (
    typeof place.id === 'string' &&
    typeof place.name === 'string' &&
    typeof place.address === 'string' &&
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  );
}

export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const { data, error } = await supabase.functions.invoke<PlaceSearchResponse>('search-places', {
    body: { query: trimmedQuery },
  });

  if (error) {
    throw new Error(error.message || 'Place search failed.');
  }

  if (!Array.isArray(data?.places)) {
    throw new Error('Place search returned an invalid result.');
  }

  return data.places.filter(isPlaceSearchResult);
}
