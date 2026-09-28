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
 * Walking is always included so long trips still have a cost/time anchor for
 * inverted min-max normalization. Ineligible modes are removed after scoring
 * in `calculateTripRecommendation` so they are not recommended or shown.
 */
export function buildModeRawScores(input: TripCalculationInput): ModeRawScores[] {
  const { distanceKm, fuelPricePerLiter, fuelEfficiencyKmPerLiter, ownVehicleTravelTimeMinutes } =
    input;

  const ownFuelCost =
    fuelEfficiencyKmPerLiter > 0
      ? (distanceKm / fuelEfficiencyKmPerLiter) * fuelPricePerLiter
      : 999999;

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
      // Keep walking in the SAW matrix as a scale anchor even when the trip is
      // too long to recommend it. Other modes only participate when eligible.
      if (code !== 'WALKING' && !isModeEligibleForDistance(defaults, distanceKm)) {
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

function isEvaluationEligible(
  modeCode: TransportModeCode,
  distanceKm: number,
): boolean {
  if (modeCode === 'OWN_VEHICLE') return true;
  return isModeEligibleForDistance(TRANSPORT_MODE_DEFAULTS[modeCode], distanceKm);
}

export function calculateTripRecommendation(input: TripCalculationInput) {
  const rawScores = buildModeRawScores(input);
  const evaluations = evaluateModes(rawScores, input.weights);

  // Drop modes that are not practical for this distance (e.g. walking 10 km)
  // after SAW so normalization still used their raw values as anchors.
  const eligible = evaluations.filter((evaluation) =>
    isEvaluationEligible(evaluation.modeCode, input.distanceKm),
  );

  const sorted = [...eligible].sort((a, b) => b.weightedScore - a.weightedScore);
  const recommended = sorted[0] ?? null;
  return { evaluations: sorted, recommended };
}
