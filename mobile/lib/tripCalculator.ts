import type { TransportModeCode } from '@/constants/transportModes';
import {
  OWN_VEHICLE_DEFAULTS,
  TRANSPORT_MODE_DEFAULTS,
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

export function buildModeRawScores(input: TripCalculationInput): ModeRawScores[] {
  const { distanceKm, fuelPricePerLiter, fuelEfficiencyKmPerLiter, ownVehicleTravelTimeMinutes } =
    input;

  const ownFuelCost =
    fuelEfficiencyKmPerLiter > 0 ? (distanceKm / fuelEfficiencyKmPerLiter) * fuelPricePerLiter : 999999;

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
      modes.push({
        modeCode: code,
        fuelCost: defaults.costPerKm * distanceKm,
        travelTime: travelTimeMinutes(distanceKm, defaults.avgSpeedKmh),
      });
    }
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
