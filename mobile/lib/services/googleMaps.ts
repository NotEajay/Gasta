import { supabase } from '@/lib/supabase';

export interface DirectionsRoute {
  /** Total route distance in kilometers. */
  distanceKm: number;
  /** Total estimated driving duration in minutes. */
  durationMinutes: number;
  /** Road path as WGS84 points (from Google overview polyline). */
  coordinates: Array<{ latitude: number; longitude: number }>;
}

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

export class DirectionsError extends Error {
  readonly code: DirectionsErrorCode;
  readonly userMessage: string;

  constructor(code: DirectionsErrorCode, userMessage: string) {
    super(userMessage);
    this.name = 'DirectionsError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

interface DirectionsFunctionError {
  error?: {
    code?: unknown;
    userMessage?: unknown;
  };
}

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

const REQUEST_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDirectionsRoute(value: unknown): value is DirectionsRoute {
  if (!isRecord(value)) return false;
  if (
    typeof value.distanceKm !== 'number' ||
    !Number.isFinite(value.distanceKm) ||
    value.distanceKm <= 0 ||
    typeof value.durationMinutes !== 'number' ||
    !Number.isFinite(value.durationMinutes) ||
    value.durationMinutes <= 0
  ) {
    return false;
  }

  // Older deployments may omit coordinates; treat as empty path.
  if (value.coordinates === undefined) {
    return true;
  }
  if (!Array.isArray(value.coordinates) || value.coordinates.length < 2) {
    return false;
  }
  return value.coordinates.every(
    (point) =>
      isRecord(point) &&
      typeof point.latitude === 'number' &&
      Number.isFinite(point.latitude) &&
      typeof point.longitude === 'number' &&
      Number.isFinite(point.longitude),
  );
}

function errorCodeForHttpStatus(status: number): DirectionsErrorCode {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'request_denied';
  if (status === 404) return 'not_found';
  if (status === 429) return 'quota';
  if (status === 502) return 'network';
  if (status === 504) return 'timeout';
  return 'server_error';
}

function errorForCode(code: unknown, fallback: DirectionsErrorCode = 'server_error'): DirectionsError {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)) {
    const knownCode = code as DirectionsErrorCode;
    return new DirectionsError(knownCode, ERROR_MESSAGES[knownCode]);
  }
  return new DirectionsError(fallback, ERROR_MESSAGES[fallback]);
}

function getErrorContext(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'context' in error) {
    return (error as { context?: unknown }).context;
  }
  return undefined;
}

function getErrorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

async function readFunctionErrorBody(context: unknown): Promise<unknown> {
  if (!context || typeof context !== 'object') return undefined;
  const json = (context as { json?: unknown }).json;
  if (typeof json !== 'function') return undefined;
  try {
    return await (json as () => Promise<unknown>).call(context);
  } catch {
    return undefined;
  }
}

async function errorFromFunction(error: unknown): Promise<DirectionsError> {
  const name = getErrorName(error);
  const context = getErrorContext(error);
  const body = (await readFunctionErrorBody(context)) as DirectionsFunctionError | undefined;
  const bodyCode = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  if (typeof bodyCode === 'string') return errorForCode(bodyCode);

  if (name === 'FunctionsFetchError') {
    const contextName = getErrorName(context);
    return errorForCode(contextName === 'AbortError' ? 'timeout' : 'network', 'network');
  }
  if (name === 'FunctionsRelayError') return errorForCode('network', 'network');
  if (name === 'FunctionsHttpError') {
    const status =
      isRecord(context) && typeof context.status === 'number' ? context.status : 500;
    return errorForCode(errorCodeForHttpStatus(status));
  }
  if (name === 'AbortError') return errorForCode('timeout');
  return errorForCode('network', 'network');
}

/**
 * Retrieve one driving route through the authenticated Supabase Edge Function.
 * The Google API key remains server-side; the client only receives normalized
 * distance and duration values or a stable DirectionsError.
 */
export async function getDrivingRoute(
  origin: string,
  destination: string,
  signal?: AbortSignal
): Promise<DirectionsRoute> {
  const trimmedOrigin = origin.trim();
  const trimmedDestination = destination.trim();
  if (!trimmedOrigin || !trimmedDestination) {
    throw new DirectionsError(
      'invalid_request',
      'Enter both an origin and a destination before optimizing.'
    );
  }

  try {
    const { data, error } = await supabase.functions.invoke<DirectionsRoute>('google-directions', {
      body: { origin: trimmedOrigin, destination: trimmedDestination },
      signal,
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (error) throw await errorFromFunction(error);
    if (!isDirectionsRoute(data)) {
      throw new DirectionsError(
        'invalid_response',
        ERROR_MESSAGES.invalid_response
      );
    }

    return {
      distanceKm: data.distanceKm,
      durationMinutes: data.durationMinutes,
      coordinates: Array.isArray(data.coordinates) ? data.coordinates : [],
    };
  } catch (error) {
    if (error instanceof DirectionsError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new DirectionsError('timeout', ERROR_MESSAGES.timeout);
    }
    if (
      error instanceof Error &&
      ['FunctionsFetchError', 'FunctionsHttpError', 'FunctionsRelayError'].includes(error.name)
    ) {
      throw await errorFromFunction(error);
    }
    throw new DirectionsError('network', ERROR_MESSAGES.network);
  }
}

