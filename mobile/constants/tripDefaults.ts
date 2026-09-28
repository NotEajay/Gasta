import type { TransportModeCode } from './transportModes';

/**
 * Assumptions for non-owned transport modes used by the Trip Cost Optimizer.
 *
 * Travel times for motorized modes are preferably derived from the Google
 * driving duration (factor + buffer) so alternatives stay comparable to the
 * real route. Absolute avgSpeedKmh is the fallback when no driving duration
 * is available, and is always used for walking.
 */
export interface TransportModeDefaults {
  /** Legacy flat ₱/km used only when `fare` is omitted. */
  costPerKm: number;
  avgSpeedKmh: number;
  /** Multiply driving duration; 1 = same road time as a private car. */
  drivingTimeFactor: number;
  /** Fixed minutes added for waiting / pickup / transfers. */
  timeBufferMinutes: number;
  /** When set, the mode is omitted from SAW above this distance. */
  maxDistanceKm: number | null;
  /** LTFRB-style base + per-km fare. Prefer this over flat costPerKm. */
  fare?: {
    baseFare: number;
    includedKm: number;
    perKmAfter: number;
  };
}

export const TRANSPORT_MODE_DEFAULTS: Record<
  Exclude<TransportModeCode, 'OWN_VEHICLE'>,
  TransportModeDefaults
> = {
  // Urban jeepney: cheap fare, slower door-to-door (wait + stops).
  JEEPNEY: {
    costPerKm: 2.5,
    avgSpeedKmh: 18,
    drivingTimeFactor: 1.35,
    timeBufferMinutes: 6,
    maxDistanceKm: null,
    fare: { baseFare: 13, includedKm: 4, perKmAfter: 1.8 },
  },
  // Typical short-hop tricycle; not competitive on longer trips.
  TRICYCLE: {
    costPerKm: 10,
    avgSpeedKmh: 22,
    drivingTimeFactor: 1.2,
    timeBufferMinutes: 3,
    maxDistanceKm: 8,
    fare: { baseFare: 30, includedKm: 1, perKmAfter: 10 },
  },
  // Ride-hailing tracks driving time closely, with a pickup buffer.
  RIDE_HAILING: {
    costPerKm: 18,
    avgSpeedKmh: 30,
    drivingTimeFactor: 1.0,
    timeBufferMinutes: 5,
    maxDistanceKm: null,
    fare: { baseFare: 49, includedKm: 1, perKmAfter: 14 },
  },
  // Walking is free but only practical for short distances.
  WALKING: {
    costPerKm: 0,
    avgSpeedKmh: 5,
    drivingTimeFactor: 0,
    timeBufferMinutes: 0,
    maxDistanceKm: 2.5,
  },
};

/** Own-vehicle assumptions when computing travel time without a live route. */
export const OWN_VEHICLE_DEFAULTS = {
  avgSpeedKmh: 40,
};

export function travelTimeMinutes(distanceKm: number, avgSpeedKmh: number): number {
  if (avgSpeedKmh <= 0) {
    return 0;
  }
  return (distanceKm / avgSpeedKmh) * 60;
}

/** Estimated fare for a mode (base + per-km when configured). */
export function estimateModeCost(
  distanceKm: number,
  defaults: TransportModeDefaults,
): number {
  if (defaults.fare) {
    const { baseFare, includedKm, perKmAfter } = defaults.fare;
    if (distanceKm <= includedKm) return baseFare;
    return baseFare + (distanceKm - includedKm) * perKmAfter;
  }
  return defaults.costPerKm * distanceKm;
}

/**
 * Estimated travel time for a non-owned mode.
 * Motorized modes prefer the live driving duration so SAW compares like-for-like.
 */
export function estimateModeTravelTime(
  distanceKm: number,
  defaults: TransportModeDefaults,
  drivingDurationMinutes?: number | null,
): number {
  // Walking (and any mode with factor 0) always uses walking/absolute speed.
  if (defaults.drivingTimeFactor <= 0) {
    return travelTimeMinutes(distanceKm, defaults.avgSpeedKmh);
  }

  if (drivingDurationMinutes != null && drivingDurationMinutes > 0) {
    return (
      drivingDurationMinutes * defaults.drivingTimeFactor + defaults.timeBufferMinutes
    );
  }

  return (
    travelTimeMinutes(distanceKm, defaults.avgSpeedKmh) + defaults.timeBufferMinutes
  );
}

export function isModeEligibleForDistance(
  defaults: TransportModeDefaults,
  distanceKm: number,
): boolean {
  if (defaults.maxDistanceKm == null) return true;
  return distanceKm <= defaults.maxDistanceKm;
}
