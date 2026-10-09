import type { TransportModeCode } from '@/constants/transportModes';
import {
  OWN_VEHICLE_DEFAULTS,
  TRANSPORT_MODE_DEFAULTS,
  estimateModeCost,
  estimateModeTravelTime,
  isModeEligibleForDistance,
  travelTimeMinutes,
} from '@/constants/tripDefaults';
import { evaluateModes, type ModeRawScores } from '@/lib/mcda';
import type { MCDAWeights } from '@/types/mcda';

export interface TripCalculationInput {
  distanceKm: number;
  fuelPricePerLiter: number;
  fuelEfficiencyKmPerLiter: number;
  weights: MCDAWeights;
  /** Optional route-derived driving duration. Falls back to the documented average speed. */
  ownVehicleTravelTimeMinutes?: number;
}

/**
 * Builds raw SAW inputs (cost + travel time) for each transport mode.
 *
 * Only eligible alternatives participate in normalization. A hidden walking
 * option on a long trip must not compress the time differences of the options
 * the user can actually choose.
 */
export function buildModeRawScores(input: TripCalculationInput): ModeRawScores[] {
  const { distanceKm, fuelPricePerLiter, fuelEfficiencyKmPerLiter, ownVehicleTravelTimeMinutes } =
    input;

  if (![distanceKm, fuelPricePerLiter, fuelEfficiencyKmPerLiter].every((value) => Number.isFinite(value) && value > 0) ||
      (ownVehicleTravelTimeMinutes != null && (!Number.isFinite(ownVehicleTravelTimeMinutes) || ownVehicleTravelTimeMinutes <= 0))) {
    throw new Error('Enter a valid distance, fuel price, efficiency and travel time.');
  }
  const ownFuelCost = (distanceKm / fuelEfficiencyKmPerLiter) * fuelPricePerLiter;

  const ownTravelTime =
    ownVehicleTravelTimeMinutes != null && ownVehicleTravelTimeMinutes > 0
      ? ownVehicleTravelTimeMinutes
      : travelTimeMinutes(distanceKm, OWN_VEHICLE_DEFAULTS.avgSpeedKmh);

  const modes: ModeRawScores[] = [
    {
      modeCode: 'OWN_VEHICLE',
      fuelCost: ownFuelCost,
      travelTime: ownTravelTime,
    },
  ];

  (Object.keys(TRANSPORT_MODE_DEFAULTS) as Exclude<TransportModeCode, 'OWN_VEHICLE'>[]).forEach(
    (code) => {
      const defaults = TRANSPORT_MODE_DEFAULTS[code];
      if (!isModeEligibleForDistance(defaults, distanceKm)) {
        return;
      }

      modes.push({
        modeCode: code,
        fuelCost: estimateModeCost(distanceKm, defaults),
        travelTime: estimateModeTravelTime(
          distanceKm,
          defaults,
          ownVehicleTravelTimeMinutes,
        ),
      });
    },
  );

  return modes;
}

export function calculateTripRecommendation(input: TripCalculationInput) {
  const rawScores = buildModeRawScores(input);
  const evaluations = evaluateModes(rawScores, input.weights);

  const sorted = [...evaluations].sort((a, b) => b.weightedScore - a.weightedScore);
  const recommended = sorted[0] ?? null;
  return { evaluations: sorted, recommended };
}
