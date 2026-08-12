import type { MCDACriterionKey, MCDAWeights, ModeEvaluation } from '@/types/mcda';
import type { TransportModeCode } from '@/constants/transportModes';

export type { MCDACriterionKey, MCDAWeights, ModeEvaluation };

export interface ModeRawScores {
  modeCode: TransportModeCode;
  fuelCost: number;
  travelTime: number;
  depreciation: number;
}

const CRITERION_KEYS: MCDACriterionKey[] = ['fuelCost', 'travelTime', 'depreciation'];

/** Inverted min-max normalization: (max - x) / (max - min). Lower raw = better. */
export function normalizeCriterion(value: number, min: number, max: number): number {
  if (max === min) {
    return 1;
  }
  return (max - value) / (max - min);
}

export function weightsSumToOne(weights: MCDAWeights, tolerance = 0.001): boolean {
  const sum = weights.fuelCost + weights.travelTime + weights.depreciation;
  return Math.abs(sum - 1) <= tolerance;
}

/** Weighted sum MCDA over three cost-type criteria. Returns full breakdown per mode. */
export function evaluateModes(
  modes: ModeRawScores[],
  weights: MCDAWeights
): ModeEvaluation[] {
  if (modes.length === 0) {
    return [];
  }

  const mins = Object.fromEntries(
    CRITERION_KEYS.map((key) => [key, Math.min(...modes.map((m) => m[key]))])
  ) as Record<MCDACriterionKey, number>;

  const maxs = Object.fromEntries(
    CRITERION_KEYS.map((key) => [key, Math.max(...modes.map((m) => m[key]))])
  ) as Record<MCDACriterionKey, number>;

  return modes.map((mode) => {
    const normalized = {
      fuelCost: normalizeCriterion(mode.fuelCost, mins.fuelCost, maxs.fuelCost),
      travelTime: normalizeCriterion(mode.travelTime, mins.travelTime, maxs.travelTime),
      depreciation: normalizeCriterion(mode.depreciation, mins.depreciation, maxs.depreciation),
    };

    const weightedScore =
      normalized.fuelCost * weights.fuelCost +
      normalized.travelTime * weights.travelTime +
      normalized.depreciation * weights.depreciation;

    return {
      modeCode: mode.modeCode,
      raw: {
        fuelCost: mode.fuelCost,
        travelTime: mode.travelTime,
        depreciation: mode.depreciation,
      },
      normalized,
      weightedScore,
    };
  });
}

export function getRecommendedMode(evaluations: ModeEvaluation[]): TransportModeCode | null {
  if (evaluations.length === 0) {
    return null;
  }

  return evaluations.reduce((best, current) =>
    current.weightedScore > best.weightedScore ? current : best
  ).modeCode;
}
