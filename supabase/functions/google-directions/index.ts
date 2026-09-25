import { createClient } from 'npm:@supabase/supabase-js@2';

type DirectionsErrorCode =
  | 'missing_key'
  | 'unauthorized'
  | 'not_found'
  | 'invalid_request'
  | 'request_denied'
  | 'quota'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'invalid_response';

type DirectionsErrorBody = {
  error: {
    code: DirectionsErrorCode;
    userMessage: string;
  };
};

type DirectionsRequestBody = {
  origin?: unknown;
  destination?: unknown;
  mode?: unknown;
  region?: unknown;
  units?: unknown;
};

type DirectionsLeg = {
  distance?: { value?: number };
  duration?: { value?: number };
};

type GoogleDirectionsResponse = {
  status?: string;
  routes?: Array<{ legs?: DirectionsLeg[] }>;
};

type RouteResult = {
  distanceKm: number;
  durationMinutes: number;
};

const ENDPOINT = 'https://maps.googleapis.com/maps/api/directions/json';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_LOCATION_LENGTH = 500;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ERROR_MESSAGES: Record<DirectionsErrorCode, string> = {
  missing_key: 'Google Maps route lookup is not configured. Ask an administrator to add the Maps API key.',
  unauthorized: 'Sign in to retrieve a driving route.',
  not_found: "Couldn't find a route for that address — try a more specific location.",
  invalid_request:
    "Couldn't understand those locations — enter a more specific origin and destination.",
  request_denied:
    'Google Maps route lookup is not authorized for this app. Check the Directions API key settings.',
  quota: 'Google Maps route lookup is temporarily over quota. Please try again later.',
  server_error: "Google Maps couldn't return a route right now. Please try again.",
  network: "Couldn't reach Google Maps. Check your connection and try again.",
  timeout: 'Google Maps took too long to return a route. Check your connection and try again.',
  invalid_response: 'Google Maps returned an unreadable route response. Please try again.',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: DirectionsErrorCode, status: number): Response {
  return jsonResponse(
    { error: { code, userMessage: ERROR_MESSAGES[code] } } satisfies DirectionsErrorBody,
    status
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function parseRequest(value: DirectionsRequestBody): {
  origin: string;
  destination: string;
  mode: string;
  region: string;
  units: string;
} | null {
  if (!isRecord(value)) return null;

  const origin = optionalString(value.origin);
  const destination = optionalString(value.destination);
  if (!origin || !destination) return null;
  if (origin.length > MAX_LOCATION_LENGTH || destination.length > MAX_LOCATION_LENGTH) {
    return null;
  }

  // Defaults preserve the parameters used by the existing mobile service.
  const mode = value.mode === undefined ? 'driving' : optionalString(value.mode);
  const region = value.region === undefined ? 'ph' : optionalString(value.region);
  const units = value.units === undefined ? 'metric' : optionalString(value.units);
  if (!mode || !region || !units || mode !== 'driving') return null;
  if (region.length > 10 || !['metric', 'imperial'].includes(units)) return null;

  return { origin, destination, mode, region, units };
}

function errorCodeForGoogleStatus(status: string): DirectionsErrorCode {
  switch (status) {
    case 'NOT_FOUND':
    case 'ZERO_RESULTS':
      return 'not_found';
    case 'INVALID_REQUEST':
      return 'invalid_request';
    case 'REQUEST_DENIED':
      return 'request_denied';
    case 'OVER_QUERY_LIMIT':
      return 'quota';
    case 'UNKNOWN_ERROR':
    case 'MAX_WAYPOINTS_EXCEEDED':
    default:
      return 'server_error';
  }
}

function errorCodeForHttpStatus(status: number): DirectionsErrorCode {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'request_denied';
  if (status === 429) return 'quota';
  if (status === 504) return 'timeout';
  return 'server_error';
}

function statusForErrorCode(code: DirectionsErrorCode): number {
  switch (code) {
    case 'invalid_request':
      return 400;
    case 'unauthorized':
      return 401;
    case 'not_found':
      return 404;
    case 'request_denied':
      return 403;
    case 'quota':
      return 429;
    case 'timeout':
      return 504;
    case 'network':
    case 'invalid_response':
    case 'server_error':
      return 502;
    case 'missing_key':
    default:
      return 500;
  }
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getSupabaseKey(): string | null {
  const configuredKeys = [
    Deno.env.get('SUPABASE_ANON_KEY'),
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY'),
  ];
  for (const configuredKey of configuredKeys) {
    const value = configuredKey?.trim();
    if (value) return value;
  }

  // New Supabase projects expose publishable keys as a JSON dictionary.
  const publishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')?.trim();
  if (!publishableKeys) return null;

  try {
    const parsed: unknown = JSON.parse(publishableKeys);
    if (!isRecord(parsed)) return null;
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

async function hasValidSession(request: Request): Promise<boolean> {
  const accessToken = getBearerToken(request);
  if (!accessToken) return false;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const supabaseKey = getSupabaseKey();
  if (!supabaseUrl || !supabaseKey) return false;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser(accessToken);
    return !error && Boolean(data.user);
  } catch {
    return false;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return errorResponse('invalid_request', 405);
  }

  if (!(await hasValidSession(request))) {
    return errorResponse('unauthorized', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_request', 400);
  }

  const parsed = parseRequest(body as DirectionsRequestBody);
  if (!parsed) return errorResponse('invalid_request', 400);

  const key = Deno.env.get('GOOGLE_MAPS_API_KEY')?.trim();
  if (!key) return errorResponse('missing_key', statusForErrorCode('missing_key'));

  const query = new URLSearchParams({
    origin: parsed.origin,
    destination: parsed.destination,
    mode: parsed.mode,
    region: parsed.region,
    units: parsed.units,
    key,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'request_denied'
          : errorCodeForHttpStatus(response.status);
      return errorResponse(code, statusForErrorCode(code));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return errorResponse('invalid_response', 502);
    }
    if (!isRecord(payload)) return errorResponse('invalid_response', 502);

    const googlePayload = payload as GoogleDirectionsResponse;
    if (googlePayload.status !== 'OK') {
      const code = errorCodeForGoogleStatus(googlePayload.status ?? 'UNKNOWN_ERROR');
      return errorResponse(code, statusForErrorCode(code));
    }

    const legs = googlePayload.routes?.[0]?.legs;
    if (!Array.isArray(legs) || legs.length === 0) {
      return errorResponse('not_found', 404);
    }

    let distanceMeters = 0;
    let durationSeconds = 0;
    for (const leg of legs) {
      if (!isRecord(leg) || !isRecord(leg.distance) || !isRecord(leg.duration)) {
        return errorResponse('invalid_response', 502);
      }
      const distanceValue = leg.distance.value;
      const durationValue = leg.duration.value;
      if (
        typeof distanceValue !== 'number' ||
        !Number.isFinite(distanceValue) ||
        typeof durationValue !== 'number' ||
        !Number.isFinite(durationValue)
      ) {
        return errorResponse('invalid_response', 502);
      }
      distanceMeters += distanceValue;
      durationSeconds += durationValue;
    }

    if (distanceMeters <= 0) return errorResponse('not_found', 404);
    if (durationSeconds <= 0) return errorResponse('invalid_response', 502);

    const result: RouteResult = {
      distanceKm: distanceMeters / 1_000,
      durationMinutes: durationSeconds / 60,
    };
    return jsonResponse(result);
  } catch (error) {
    if (isAbortError(error)) return errorResponse('timeout', 504);
    return errorResponse('network', 502);
  } finally {
    clearTimeout(timeout);
  }
});

