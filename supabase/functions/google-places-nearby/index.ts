import { createClient } from "npm:@supabase/supabase-js@2";

type ErrorCode =
  | "missing_key"
  | "unauthorized"
  | "invalid_request"
  | "request_denied"
  | "quota"
  | "server_error"
  | "network"
  | "timeout"
  | "invalid_response";

type NearbyRequest = {
  latitude?: unknown;
  longitude?: unknown;
  radiusMeters?: unknown;
};

type Station = {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
};

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_RADIUS_METERS = 5_000;
const MAX_RADIUS_METERS = 10_000;
const MAX_RESULTS = 20;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const messages: Record<ErrorCode, string> = {
  missing_key: "Nearby station search is not configured.",
  unauthorized: "Sign in to find nearby stations.",
  invalid_request: "A valid location is required to find nearby stations.",
  request_denied: "Nearby station search is not authorized.",
  quota: "Nearby station search is temporarily over quota.",
  server_error: "Google Maps could not return nearby stations.",
  network: "Could not reach Google Maps.",
  timeout: "Google Maps took too long to return nearby stations.",
  invalid_response: "Google Maps returned an unreadable station response.",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(code: ErrorCode, status: number): Response {
  return json({ error: { code, userMessage: messages[code] } }, status);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getBearerToken(request: Request): string | null {
  const value = request.headers.get("Authorization")?.trim() ?? "";
  return value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function getSupabaseKey(): string | null {
  return (
    Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY")?.trim() ||
    null
  );
}

async function hasValidSession(request: Request): Promise<boolean> {
  const token = getBearerToken(request);
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = getSupabaseKey();
  if (!token || !url || !key) return false;
  try {
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.getUser(token);
    return !error && Boolean(data.user);
  } catch {
    return false;
  }
}

function parseRequest(value: unknown): { latitude: number; longitude: number; radiusMeters: number } | null {
  if (!record(value)) return null;
  const latitude = number(value.latitude);
  const longitude = number(value.longitude);
  const requestedRadius = value.radiusMeters === undefined ? DEFAULT_RADIUS_METERS : number(value.radiusMeters);
  if (
    latitude === undefined ||
    longitude === undefined ||
    requestedRadius === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    requestedRadius <= 0 ||
    requestedRadius > MAX_RADIUS_METERS
  ) {
    return null;
  }
  return { latitude, longitude, radiusMeters: requestedRadius };
}

function errorCode(status: string | undefined): ErrorCode {
  switch (status) {
    case "PERMISSION_DENIED":
    case "UNAUTHENTICATED":
    case "API_KEY_INVALID":
      return "request_denied";
    case "RESOURCE_EXHAUSTED":
      return "quota";
    case "DEADLINE_EXCEEDED":
      return "timeout";
    case "INVALID_ARGUMENT":
      return "invalid_request";
    default:
      return "server_error";
  }
}

function statusFor(code: ErrorCode): number {
  if (code === "invalid_request") return 400;
  if (code === "unauthorized") return 401;
  if (code === "request_denied") return 403;
  if (code === "quota") return 429;
  if (code === "timeout") return 504;
  if (code === "missing_key") return 500;
  return 502;
}

function normalizeStation(value: unknown): Station | null {
  if (!record(value) || !record(value.location)) return null;
  const placeId = string(value.id);
  const displayName = record(value.displayName) ? string(value.displayName.text) : undefined;
  const latitude = number(value.location.latitude);
  const longitude = number(value.location.longitude);
  const address = string(value.formattedAddress);
  if (!placeId || !displayName || !address || latitude === undefined || longitude === undefined) {
    return null;
  }
  const hours = record(value.currentOpeningHours);
  const result: Station = {
    placeId,
    name: displayName,
    latitude,
    longitude,
    formattedAddress: address,
  };
  const businessStatus = string(value.businessStatus);
  const rating = number(value.rating);
  const userRatingCount = number(value.userRatingCount);
  const openNow = hours ? valueOfBoolean(hours.openNow) : undefined;
  if (businessStatus) result.businessStatus = businessStatus;
  if (rating !== undefined) result.rating = rating;
  if (userRatingCount !== undefined) result.userRatingCount = userRatingCount;
  if (openNow !== undefined) result.openNow = openNow;
  return result;
}

function valueOfBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return errorResponse("invalid_request", 405);
  if (!(await hasValidSession(request))) return errorResponse("unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  const parsed = parseRequest(body);
  if (!parsed) return errorResponse("invalid_request", 400);
  const key = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
  if (!key) return errorResponse("missing_key", statusFor("missing_key"));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.location,places.formattedAddress,places.businessStatus,places.rating,places.userRatingCount,places.currentOpeningHours.openNow",
      },
      body: JSON.stringify({
        includedTypes: ["gas_station"],
        maxResultCount: MAX_RESULTS,
        rankPreference: "DISTANCE",
        regionCode: "PH",
        locationRestriction: {
          circle: {
            center: { latitude: parsed.latitude, longitude: parsed.longitude },
            radius: parsed.radiusMeters,
          },
        },
      }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const googleError = record(payload) && record(payload.error) ? payload.error : null;
      const code = errorCode(string(googleError?.status));
      return errorResponse(code, statusFor(code));
    }
    if (!record(payload) || !Array.isArray(payload.places)) {
      return errorResponse("invalid_response", 502);
    }
    const stations = payload.places
      .map(normalizeStation)
      .filter((station): station is Station => station !== null);
    return json({ stations });
  } catch (error) {
    return errorResponse(error instanceof Error && error.name === "AbortError" ? "timeout" : "network", 502);
  } finally {
    clearTimeout(timeout);
  }
});
