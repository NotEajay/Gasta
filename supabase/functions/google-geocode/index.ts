import { createClient } from "npm:@supabase/supabase-js@2";

type GeocodeErrorCode =
  | "missing_key"
  | "unauthorized"
  | "not_found"
  | "invalid_request"
  | "request_denied"
  | "quota"
  | "server_error"
  | "network"
  | "timeout"
  | "invalid_response";

type GeocodeErrorBody = {
  error: {
    code: GeocodeErrorCode;
    userMessage: string;
  };
};

type GeocodeRequestBody = {
  query?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

type GoogleGeocodeResponse = {
  status?: unknown;
  results?: unknown;
};

type GoogleGeocodeResult = {
  formatted_address?: unknown;
  place_id?: unknown;
  geometry?: {
    location?: {
      lat?: unknown;
      lng?: unknown;
    };
  };
};

type GeocodeResult = {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
};

type NormalizedResponse = {
  results: GeocodeResult[];
};

type ParsedRequest =
  | { mode: "search"; query: string }
  | { mode: "reverse"; latitude: number; longitude: number };

const ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 5;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ERROR_MESSAGES: Record<GeocodeErrorCode, string> = {
  missing_key:
    "Location search is not configured. Ask an administrator to add the Maps API key.",
  unauthorized: "Sign in to search for locations.",
  not_found: "Couldn't find that location — try a more specific search.",
  invalid_request: "Enter a place name or address to search for.",
  request_denied:
    "Location search is not authorized for this app. Check the Maps API key settings.",
  quota: "Location search is temporarily over quota. Please try again later.",
  server_error:
    "Google Maps couldn't return locations right now. Please try again.",
  network: "Couldn't reach Google Maps. Check your connection and try again.",
  timeout:
    "Google Maps took too long to return locations. Check your connection and try again.",
  invalid_response:
    "Google Maps returned an unreadable location response. Please try again.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(code: GeocodeErrorCode, status: number): Response {
  return jsonResponse(
    {
      error: { code, userMessage: ERROR_MESSAGES[code] },
    } satisfies GeocodeErrorBody,
    status,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseRequest(value: GeocodeRequestBody): ParsedRequest | null {
  if (!isRecord(value)) return null;

  const query = optionalString(value.query);
  const latitude = optionalNumber(value.latitude);
  const longitude = optionalNumber(value.longitude);

  if (query) {
    if (query.length > MAX_QUERY_LENGTH) return null;
    if (latitude !== undefined || longitude !== undefined) return null;
    return { mode: "search", query };
  }

  if (latitude === undefined || longitude === undefined) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    return null;
  return { mode: "reverse", latitude, longitude };
}

function errorCodeForGoogleStatus(status: string): GeocodeErrorCode {
  switch (status) {
    case "NOT_FOUND":
    case "ZERO_RESULTS":
      return "not_found";
    case "INVALID_REQUEST":
      return "invalid_request";
    case "REQUEST_DENIED":
      return "request_denied";
    case "OVER_DAILY_LIMIT":
    case "OVER_QUERY_LIMIT":
      return "quota";
    case "UNKNOWN_ERROR":
    default:
      return "server_error";
  }
}

function errorCodeForHttpStatus(status: number): GeocodeErrorCode {
  if (status === 400) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "request_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "quota";
  if (status === 504) return "timeout";
  return "server_error";
}

function statusForErrorCode(code: GeocodeErrorCode): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "unauthorized":
      return 401;
    case "not_found":
      return 404;
    case "request_denied":
      return 403;
    case "quota":
      return 429;
    case "timeout":
      return 504;
    case "network":
    case "invalid_response":
    case "server_error":
      return 502;
    case "missing_key":
    default:
      return 500;
  }
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getSupabaseKey(): string | null {
  const configuredKeys = [
    Deno.env.get("SUPABASE_ANON_KEY"),
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
  ];
  for (const configuredKey of configuredKeys) {
    const value = configuredKey?.trim();
    if (value) return value;
  }

  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")?.trim();
  if (!publishableKeys) return null;

  try {
    const parsed: unknown = JSON.parse(publishableKeys);
    if (!isRecord(parsed)) return null;
    for (const value of Object.values(parsed)) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

async function hasValidSession(request: Request): Promise<boolean> {
  const accessToken = getBearerToken(request);
  if (!accessToken) return false;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
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

function normalizeResult(value: unknown): GeocodeResult | null {
  if (!isRecord(value)) return null;
  const result = value as GoogleGeocodeResult;
  const formattedAddress = optionalString(result.formatted_address);
  const geometry = isRecord(result.geometry) ? result.geometry : null;
  const location =
    geometry && isRecord(geometry.location) ? geometry.location : null;
  if (!formattedAddress || !location) return null;

  const latitude = optionalNumber(location.lat);
  const longitude = optionalNumber(location.lng);
  if (latitude === undefined || longitude === undefined) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    return null;

  const placeId = optionalString(result.place_id);
  return {
    formattedAddress,
    latitude,
    longitude,
    ...(placeId ? { placeId } : {}),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return errorResponse("invalid_request", 405);
  }

  if (!(await hasValidSession(request))) {
    return errorResponse("unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }

  const parsed = parseRequest(body as GeocodeRequestBody);
  if (!parsed) return errorResponse("invalid_request", 400);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
  if (!key)
    return errorResponse("missing_key", statusForErrorCode("missing_key"));

  const query = new URLSearchParams({
    region: "ph",
    language: "en",
    key,
  });
  if (parsed.mode === "search") {
    query.set("address", parsed.query);
  } else {
    query.set("latlng", `${parsed.latitude},${parsed.longitude}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}?${query.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const code = errorCodeForHttpStatus(response.status);
      return errorResponse(code, statusForErrorCode(code));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return errorResponse("invalid_response", 502);
    }
    if (!isRecord(payload)) return errorResponse("invalid_response", 502);

    const googlePayload = payload as GoogleGeocodeResponse;
    if (googlePayload.status === "ZERO_RESULTS") {
      return jsonResponse({ results: [] } satisfies NormalizedResponse);
    }
    if (googlePayload.status !== "OK") {
      const code = errorCodeForGoogleStatus(
        typeof googlePayload.status === "string"
          ? googlePayload.status
          : "UNKNOWN_ERROR",
      );
      return errorResponse(code, statusForErrorCode(code));
    }
    if (!Array.isArray(googlePayload.results)) {
      return errorResponse("invalid_response", 502);
    }

    const results = googlePayload.results
      .map(normalizeResult)
      .filter((result): result is GeocodeResult => result !== null)
      .slice(0, MAX_RESULTS);
    return jsonResponse({ results } satisfies NormalizedResponse);
  } catch (error) {
    if (isAbortError(error)) return errorResponse("timeout", 504);
    return errorResponse("network", 502);
  } finally {
    clearTimeout(timeout);
  }
});
