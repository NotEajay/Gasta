import type { TransportModeCode } from './transportModes';

/** User-input trip assumptions for non-owned transport modes (PHP, km, minutes). */
export interface TransportModeDefaults {
  costPerKm: number;
  avgSpeedKmh: number;
}

export const TRANSPORT_MODE_DEFAULTS: Record<
  Exclude<TransportModeCode, 'OWN_VEHICLE'>,
  TransportModeDefaults
> = {
  JEEPNEY: { costPerKm: 2.5, avgSpeedKmh: 20 },
  TRICYCLE: { costPerKm: 8.0, avgSpeedKmh: 25 },
  RIDE_HAILING: { costPerKm: 15.0, avgSpeedKmh: 30 },
  WALKING: { costPerKm: 0, avgSpeedKmh: 5 },
};

/** Own-vehicle assumptions when computing travel time. */
export const OWN_VEHICLE_DEFAULTS = {
  avgSpeedKmh: 40,
};

export function travelTimeMinutes(distanceKm: number, avgSpeedKmh: number): number {
  if (avgSpeedKmh <= 0) {
    return 0;
  }
  return (distanceKm / avgSpeedKmh) * 60;
}
