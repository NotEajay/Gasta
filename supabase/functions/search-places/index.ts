const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_QUERY_LENGTH = 200;

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function parseQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const query = value.trim();
  return query && query.length <= MAX_QUERY_LENGTH ? query : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Only POST requests are supported.' }, 405);
  }

  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    return jsonResponse({ error: 'Place search is not configured.' }, 500);
  }

  let body: { query?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
  }

  const query = parseQuery(body.query);
  if (!query) {
    return jsonResponse({ error: 'A non-empty search query is required.' }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 5,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 400) {
        return jsonResponse({ error: 'Google Maps could not process that search.' }, 400);
      }
      return jsonResponse({ error: 'Google Maps place search is unavailable right now.' }, 502);
    }

    const data = (await response.json()) as {
      places?: Array<{
        id?: unknown;
        displayName?: { text?: unknown };
        formattedAddress?: unknown;
        location?: { latitude?: unknown; longitude?: unknown };
      }>;
    };

    const places = (data.places ?? []).flatMap((place) => {
      const id = typeof place.id === 'string' ? place.id : null;
      const name = typeof place.displayName?.text === 'string' ? place.displayName.text : null;
      const address =
        typeof place.formattedAddress === 'string' ? place.formattedAddress : null;
      const latitude = place.location?.latitude;
      const longitude = place.location?.longitude;

      if (
        !id ||
        !name ||
        !address ||
        typeof latitude !== 'number' ||
        typeof longitude !== 'number' ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return [];
      }

      return [{ id, name, address, coordinate: { latitude, longitude } }];
    });

    return jsonResponse({ places }, 200);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return jsonResponse({ error: 'Google Maps took too long to respond.' }, 504);
    }
    return jsonResponse({ error: 'Unable to reach Google Maps right now.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
