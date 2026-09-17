const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LOCATION_LENGTH = 500;

interface RouteRequest {
  origin?: unknown;
  destination?: unknown;
}

interface RouteCoordinate {
  latitude: number;
  longitude: number;
}

interface GoogleRoute {
  distanceMeters?: unknown;
  duration?: unknown;
}

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function parseLocation(value: unknown): string | RouteCoordinate | null {
  if (typeof value === 'string') {
    const location = value.trim();
    return location && location.length <= MAX_LOCATION_LENGTH ? location : null;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'latitude' in value &&
    'longitude' in value &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  ) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  return null;
}

function googleWaypoint(location: string | RouteCoordinate) {
  return typeof location === 'string'
    ? { address: location }
    : { location: { latLng: { latitude: location.latitude, longitude: location.longitude } } };
}

function parseDurationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds / 60 : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Only POST requests are supported.' }, 405);
  }

  const apiKey = Deno.env.get('GOOGLE_ROUTES_API_KEY');
  if (!apiKey) {
    return jsonResponse({ error: 'Route service is not configured.' }, 500);
  }

  let body: RouteRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  const origin = parseLocation(body.origin);
  const destination = parseLocation(body.destination);
  if (!origin || !destination) {
    return jsonResponse(
      { error: 'Origin and destination are required and must be valid text locations.' },
      400
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: googleWaypoint(origin),
        destination: googleWaypoint(destination),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 400) {
        return jsonResponse(
          { error: 'Google Maps could not understand one or both locations.' },
          400
        );
      }
      if (response.status === 404) {
        return jsonResponse({ error: 'No route was found between these locations.' }, 404);
      }
      return jsonResponse({ error: 'Google Maps could not calculate this route.' }, 502);
    }

    const googleData = (await response.json()) as { routes?: GoogleRoute[] };
    const route = googleData.routes?.[0];
    const distanceMeters = typeof route?.distanceMeters === 'number' ? route.distanceMeters : null;
    const durationMinutes = parseDurationMinutes(route?.duration);

    if (
      distanceMeters == null ||
      !Number.isFinite(distanceMeters) ||
      distanceMeters < 0 ||
      durationMinutes == null ||
      !Number.isFinite(durationMinutes)
    ) {
      return jsonResponse({ error: 'No usable route was found between these locations.' }, 404);
    }

    return jsonResponse(
      {
        distanceKm: distanceMeters / 1000,
        durationMinutes,
      },
      200
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return jsonResponse({ error: 'Google Maps took too long to respond.' }, 504);
    }
    return jsonResponse({ error: 'Unable to reach Google Maps right now.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
