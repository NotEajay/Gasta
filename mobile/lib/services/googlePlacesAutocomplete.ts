import { supabase } from "@/lib/supabase";

export interface PlaceSuggestion {
  placeId: string;
  description: string;
}

export interface ResolvedPlaceSuggestion extends PlaceSuggestion {
  latitude: number;
  longitude: number;
}

type PlacesAutocompleteErrorCode =
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

export class PlacesAutocompleteError extends Error {
  readonly code: PlacesAutocompleteErrorCode;
  readonly userMessage: string;

  constructor(code: PlacesAutocompleteErrorCode, userMessage: string) {
    super(userMessage);
    this.name = "PlacesAutocompleteError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

interface FunctionError {
  error?: { code?: unknown };
}

interface AutocompleteResponse {
  suggestions?: unknown;
}

interface DetailsResponse {
  result?: unknown;
}

const ERROR_MESSAGES: Record<PlacesAutocompleteErrorCode, string> = {
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

const REQUEST_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaceSuggestion(value: unknown): value is PlaceSuggestion {
  return (
    isRecord(value) &&
    typeof value.placeId === "string" &&
    value.placeId.length > 0 &&
    typeof value.description === "string" &&
    value.description.length > 0
  );
}

function isResolvedPlace(value: unknown): value is ResolvedPlaceSuggestion {
  if (!isRecord(value)) return false;
  return (
    typeof value.placeId === "string" &&
    value.placeId.length > 0 &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude)
  );
}

function errorCodeForHttpStatus(status: number): PlacesAutocompleteErrorCode {
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
  fallback: PlacesAutocompleteErrorCode = "server_error",
): PlacesAutocompleteError {
  if (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
  ) {
    const knownCode = code as PlacesAutocompleteErrorCode;
    return new PlacesAutocompleteError(knownCode, ERROR_MESSAGES[knownCode]);
  }
  return new PlacesAutocompleteError(fallback, ERROR_MESSAGES[fallback]);
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

async function errorFromFunction(
  error: unknown,
): Promise<PlacesAutocompleteError> {
  const name = getErrorName(error);
  const context = getErrorContext(error);
  const body = (await readFunctionErrorBody(context)) as
    FunctionError | undefined;
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

async function invokePlaces(
  body: Record<string, unknown>,
  responseKey: "suggestions" | "result",
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const { data, error } = await supabase.functions.invoke<
      AutocompleteResponse & DetailsResponse
    >("google-places-autocomplete", {
      body,
      signal,
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (error) throw await errorFromFunction(error);
    return isRecord(data) ? data[responseKey] : undefined;
  } catch (error) {
    if (error instanceof PlacesAutocompleteError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new PlacesAutocompleteError("timeout", ERROR_MESSAGES.timeout);
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
    throw new PlacesAutocompleteError("network", ERROR_MESSAGES.network);
  }
}

function invalidResponse(): PlacesAutocompleteError {
  return new PlacesAutocompleteError(
    "invalid_response",
    ERROR_MESSAGES.invalid_response,
  );
}

export interface AutocompleteBias {
  latitude?: number;
  longitude?: number;
}

export async function searchPlaceSuggestions(
  query: string,
  bias?: AutocompleteBias,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    throw new PlacesAutocompleteError(
      "invalid_request",
      ERROR_MESSAGES.invalid_request,
    );
  }
  const body: Record<string, unknown> = { query: trimmedQuery };
  if (bias?.latitude !== undefined && bias.longitude !== undefined) {
    body.latitude = bias.latitude;
    body.longitude = bias.longitude;
  }
  const value = await invokePlaces(body, "suggestions", signal);
  if (!Array.isArray(value) || !value.every(isPlaceSuggestion)) {
    throw invalidResponse();
  }
  return value;
}

export async function resolvePlaceSuggestion(
  placeId: string,
  signal?: AbortSignal,
): Promise<ResolvedPlaceSuggestion> {
  const trimmedPlaceId = placeId.trim();
  if (!trimmedPlaceId) {
    throw new PlacesAutocompleteError(
      "invalid_request",
      ERROR_MESSAGES.invalid_request,
    );
  }
  const value = await invokePlaces(
    { placeId: trimmedPlaceId },
    "result",
    signal,
  );
  if (!isResolvedPlace(value)) {
    throw invalidResponse();
  }
  return value;
}
