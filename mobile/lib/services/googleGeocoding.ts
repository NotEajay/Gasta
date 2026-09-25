import { supabase } from "@/lib/supabase";

export interface GeocodedPlace {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

type GeocodingErrorCode =
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

export class GeocodingError extends Error {
  readonly code: GeocodingErrorCode;
  readonly userMessage: string;

  constructor(code: GeocodingErrorCode, userMessage: string) {
    super(userMessage);
    this.name = "GeocodingError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

interface GeocodeFunctionError {
  error?: {
    code?: unknown;
    userMessage?: unknown;
  };
}

interface GeocodeFunctionResponse {
  results?: unknown;
}

const ERROR_MESSAGES: Record<GeocodingErrorCode, string> = {
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

const REQUEST_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGeocodedPlace(value: unknown): value is GeocodedPlace {
  if (!isRecord(value)) return false;
  return (
    typeof value.formattedAddress === "string" &&
    value.formattedAddress.trim().length > 0 &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    (value.placeId === undefined || typeof value.placeId === "string")
  );
}

/**
 * Keep reverse-geocoded labels concise for the UI without changing the value
 * sent to Directions. The address is still derived only from Google's
 * formatted response.
 */
export function getReadableAddress(formattedAddress: string): string {
  const parts = formattedAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  while (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    const normalizedPart = lastPart.toLowerCase();
    if (
      normalizedPart === "philippines" ||
      /^\d{4}(?:-\d{4})?$/.test(lastPart)
    ) {
      parts.pop();
      continue;
    }
    break;
  }

  return parts.join(", ") || formattedAddress;
}

function errorCodeForHttpStatus(status: number): GeocodingErrorCode {
  if (status === 400) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "request_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "quota";
  if (status === 504) return "timeout";
  return "server_error";
}

function errorForCode(
  code: unknown,
  fallback: GeocodingErrorCode = "server_error",
): GeocodingError {
  if (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
  ) {
    const knownCode = code as GeocodingErrorCode;
    return new GeocodingError(knownCode, ERROR_MESSAGES[knownCode]);
  }
  return new GeocodingError(fallback, ERROR_MESSAGES[fallback]);
}

function getErrorContext(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "context" in error) {
    return (error as { context?: unknown }).context;
  }
  return undefined;
}

function getErrorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

async function readFunctionErrorBody(context: unknown): Promise<unknown> {
  if (!context || typeof context !== "object") return undefined;
  const json = (context as { json?: unknown }).json;
  if (typeof json !== "function") return undefined;
  try {
    return await (json as () => Promise<unknown>).call(context);
  } catch {
    return undefined;
  }
}

async function errorFromFunction(error: unknown): Promise<GeocodingError> {
  const name = getErrorName(error);
  const context = getErrorContext(error);
  const body = (await readFunctionErrorBody(context)) as
    GeocodeFunctionError | undefined;
  const bodyCode =
    isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  if (typeof bodyCode === "string") return errorForCode(bodyCode);

  if (name === "FunctionsFetchError") {
    const contextName = getErrorName(context);
    return errorForCode(
      contextName === "AbortError" ? "timeout" : "network",
      "network",
    );
  }
  if (name === "FunctionsRelayError") return errorForCode("network", "network");
  if (name === "FunctionsHttpError") {
    const status =
      isRecord(context) && typeof context.status === "number"
        ? context.status
        : 500;
    return errorForCode(errorCodeForHttpStatus(status));
  }
  if (name === "AbortError") return errorForCode("timeout");
  return errorForCode("network", "network");
}

async function invokeGeocode(
  body: { query: string } | { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<GeocodedPlace[]> {
  try {
    const { data, error } =
      await supabase.functions.invoke<GeocodeFunctionResponse>(
        "google-geocode",
        {
          body,
          signal,
          timeout: REQUEST_TIMEOUT_MS,
        },
      );

    if (error) throw await errorFromFunction(error);
    const results = isRecord(data) ? data.results : undefined;
    if (!Array.isArray(results) || !results.every(isGeocodedPlace)) {
      throw new GeocodingError(
        "invalid_response",
        ERROR_MESSAGES.invalid_response,
      );
    }
    return results;
  } catch (error) {
    if (error instanceof GeocodingError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeocodingError("timeout", ERROR_MESSAGES.timeout);
    }
    if (
      error instanceof Error &&
      [
        "FunctionsFetchError",
        "FunctionsHttpError",
        "FunctionsRelayError",
      ].includes(error.name)
    ) {
      throw await errorFromFunction(error);
    }
    throw new GeocodingError("network", ERROR_MESSAGES.network);
  }
}

/** Search for places by name or address through the authenticated Edge Function. */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodedPlace[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new GeocodingError("invalid_request", ERROR_MESSAGES.invalid_request);
  }
  return invokeGeocode({ query: trimmedQuery }, signal);
}

/** Resolve a map coordinate into a readable address through the same secure function. */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<GeocodedPlace | null> {
  const results = await invokeGeocode({ latitude, longitude }, signal);
  return results[0] ?? null;
}
