import { createClient } from "npm:@supabase/supabase-js@2";

type AutocompleteErrorCode =
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

type AutocompleteErrorBody = {
  error: {
    code: AutocompleteErrorCode;
    userMessage: string;
  };
};

type AutocompleteRequestBody = {
  query?: unknown;
  placeId?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

type ParsedRequest =
  | {
      mode: "autocomplete";
      query: string;
      latitude?: number;
      longitude?: number;
    }
  | { mode: "details"; placeId: string };

type GooglePlacePrediction = {
  place?: unknown;
  text?: { text?: unknown };
  structuredFormat?: {
    mainText?: { text?: unknown };
    secondaryText?: { text?: unknown };
  };
};

type GoogleAutocompleteResponse = {
  suggestions?: unknown;
  error?: { status?: unknown; message?: unknown };
};

type GooglePlaceDetailsResponse = {
  id?: unknown;
  formattedAddress?: unknown;
  displayName?: { text?: unknown };
  location?: { latitude?: unknown; longitude?: unknown };
  error?: { status?: unknown; message?: unknown };
};

type PlaceSuggestion = {
  placeId: string;
  description: string;
};

type ResolvedPlace = PlaceSuggestion & {
  latitude: number;
  longitude: number;
};

type AutocompleteResponse = { suggestions: PlaceSuggestion[] };
type DetailsResponse = { result: ResolvedPlace | null };

const PLACES_ENDPOINT = "https://places.googleapis.com/v1";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_QUERY_LENGTH = 200;
const MAX_SUGGESTIONS = 5;
const LOCATION_BIAS_RADIUS_METERS = 50_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ERROR_MESSAGES: Record<AutocompleteErrorCode, string> = {
  missing_key:
    "Location suggestions are not configured. Ask an administrator to add the Maps API key.",
  unauthorized: "Sign in to search for locations.",
  not_found: "Couldn't find that location — try a more specific search.",
  invalid_request: "Enter a place name or address to search for.",
  request_denied:
    "Location suggestions are not authorized for this app. Check the Maps API key settings.",
  quota:
    "Location suggestions are temporarily over quota. Please try again later.",
  server_error:
    "Google Maps couldn't return location suggestions right now. Please try again.",
  network: "Couldn't reach Google Maps. Check your connection and try again.",
  timeout:
    "Google Maps took too long to return suggestions. Check your connection and try again.",
  invalid_response:
    "Google Maps returned an unreadable suggestions response. Please try again.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(code: AutocompleteErrorCode, status: number): Response {
  return jsonResponse(
    {
      error: { code, userMessage: ERROR_MESSAGES[code] },
    } satisfies AutocompleteErrorBody,
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

function normalizePlaceId(value: unknown): string | null {
  const placeId = optionalString(value);
  if (!placeId || placeId.length > 200) return null;
  if (!/^(places\/)?[A-Za-z0-9_-]+$/.test(placeId)) return null;
  return placeId.startsWith("places/") ? placeId : `places/${placeId}`;
}

function parseRequest(value: AutocompleteRequestBody): ParsedRequest | null {
  if (!isRecord(value)) return null;

  const placeId = normalizePlaceId(value.placeId);
  if (placeId) {
    if (
      value.query !== undefined ||
      value.latitude !== undefined ||
      value.longitude !== undefined
    ) {
      return null;
    }
    return { mode: "details", placeId };
  }
  if (value.placeId !== undefined) return null;

  const query = optionalString(value.query);
  if (!query || query.length < 2 || query.length > MAX_QUERY_LENGTH) {
    return null;
  }

  const latitude = optionalNumber(value.latitude);
  const longitude = optionalNumber(value.longitude);
  if ((latitude === undefined) !== (longitude === undefined)) return null;
  if (
    (latitude !== undefined && (latitude < -90 || latitude > 90)) ||
    (longitude !== undefined && (longitude < -180 || longitude > 180))
  ) {
    return null;
  }

  return { mode: "autocomplete", query, latitude, longitude };
}

function errorCodeForGoogleStatus(status: string): AutocompleteErrorCode {
  switch (status) {
    case "NOT_FOUND":
      return "not_found";
    case "INVALID_ARGUMENT":
      return "invalid_request";
    case "PERMISSION_DENIED":
    case "UNAUTHENTICATED":
    case "API_KEY_INVALID":
    case "API_KEY_HTTP_HEADER_INVALID":
      return "request_denied";
    case "RESOURCE_EXHAUSTED":
      return "quota";
    case "DEADLINE_EXCEEDED":
      return "timeout";
    case "UNAVAILABLE":
    case "INTERNAL":
    default:
      return "server_error";
  }
}

function errorCodeForHttpStatus(status: number): AutocompleteErrorCode {
  if (status === 400) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "request_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "quota";
  if (status === 504) return "timeout";
  return "server_error";
}

function statusForErrorCode(code: AutocompleteErrorCode): number {
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

function descriptionFromPrediction(
  prediction: GooglePlacePrediction,
): string | undefined {
  const text = optionalString(prediction.text?.text);
  if (text) return text;
  const mainText = optionalString(prediction.structuredFormat?.mainText?.text);
  const secondaryText = optionalString(
    prediction.structuredFormat?.secondaryText?.text,
  );
  if (mainText && secondaryText) return `${mainText}, ${secondaryText}`;
  return mainText;
}

function normalizeSuggestion(value: unknown): PlaceSuggestion | null {
  if (!isRecord(value)) return null;
  const prediction = value.placePrediction;
  if (!isRecord(prediction)) return null;
  const placeId = normalizePlaceId(prediction.place);
  const description = descriptionFromPrediction(
    prediction as GooglePlacePrediction,
  );
  if (!placeId || !description) return null;
  return { placeId, description };
}

function normalizeDetails(
  payload: GooglePlaceDetailsResponse,
  fallbackPlaceId: string,
): ResolvedPlace | null {
  const location = payload.location;
  if (!isRecord(location)) return null;
  const latitude = optionalNumber(location.latitude);
  const longitude = optionalNumber(location.longitude);
  const description =
    optionalString(payload.formattedAddress) ??
    optionalString(payload.displayName?.text);
  if (
    !description ||
    latitude === undefined ||
    longitude === undefined ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return {
    placeId: normalizePlaceId(payload.id) ?? fallbackPlaceId,
    description,
    latitude,
    longitude,
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

  const parsed = parseRequest(body as AutocompleteRequestBody);
  if (!parsed) return errorResponse("invalid_request", 400);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
  if (!key)
    return errorResponse("missing_key", statusForErrorCode("missing_key"));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    if (parsed.mode === "autocomplete") {
      const requestBody: Record<string, unknown> = {
        input: parsed.query,
        includedRegionCodes: ["ph"],
        languageCode: "en",
      };
      if (parsed.latitude !== undefined && parsed.longitude !== undefined) {
        requestBody.locationBias = {
          circle: {
            center: { latitude: parsed.latitude, longitude: parsed.longitude },
            radius: LOCATION_BIAS_RADIUS_METERS,
          },
        };
      }
      response = await fetch(`${PLACES_ENDPOINT}/places:autocomplete`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "suggestions.placePrediction.place,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } else {
      const placeId = parsed.placeId.replace(/^places\//, "");
      response = await fetch(`${PLACES_ENDPOINT}/places/${placeId}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "id,formattedAddress,displayName,location",
        },
        signal: controller.signal,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return errorResponse("invalid_response", 502);
    }
    if (!isRecord(payload)) return errorResponse("invalid_response", 502);

    if (!response.ok) {
      const googleError = isRecord(payload.error) ? payload.error : null;
      const googleStatus = optionalString(googleError?.status);
      const code = googleStatus
        ? errorCodeForGoogleStatus(googleStatus)
        : errorCodeForHttpStatus(response.status);
      return errorResponse(code, statusForErrorCode(code));
    }

    if (parsed.mode === "autocomplete") {
      const googlePayload = payload as GoogleAutocompleteResponse;
      if (!Array.isArray(googlePayload.suggestions)) {
        return errorResponse("invalid_response", 502);
      }
      const suggestions = googlePayload.suggestions
        .map(normalizeSuggestion)
        .filter(
          (suggestion): suggestion is PlaceSuggestion => suggestion !== null,
        )
        .slice(0, MAX_SUGGESTIONS);
      return jsonResponse({ suggestions } satisfies AutocompleteResponse);
    }

    const result = normalizeDetails(
      payload as GooglePlaceDetailsResponse,
      parsed.placeId,
    );
    if (!result) return errorResponse("not_found", 404);
    return jsonResponse({ result } satisfies DetailsResponse);
  } catch (error) {
    if (isAbortError(error)) return errorResponse("timeout", 504);
    return errorResponse("network", 502);
  } finally {
    clearTimeout(timeout);
  }
});
