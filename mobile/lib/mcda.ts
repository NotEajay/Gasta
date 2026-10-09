import { DEFAULT_MCDA_WEIGHTS } from '@/constants/mcda';
import type { MCDACriterionKey, MCDAWeights, ModeEvaluation } from '@/types/mcda';
import type { TransportModeCode } from '@/constants/transportModes';

export type { MCDACriterionKey, MCDAWeights, ModeEvaluation };

export interface ModeRawScores {
  modeCode: TransportModeCode;
  fuelCost: number;
  travelTime: number;
}

const CRITERION_KEYS: MCDACriterionKey[] = ['fuelCost', 'travelTime'];

/** Slider position: left saves money, right saves time. Never round calculation weights. */
export function clampTimePriority(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_MCDA_WEIGHTS.travelTime;
  return Math.min(1, Math.max(0, value));
}

export function weightsForTimePriority(value: number): MCDAWeights {
  const travelTime = clampTimePriority(value);
  return { fuelCost: 1 - travelTime, travelTime };
}

/** Inverted min-max normalization: (max - x) / (max - min). Lower raw = better. */
export function normalizeCriterion(value: number, min: number, max: number): number {
  if (max === min) {
    return 1;
  }
  return (max - value) / (max - min);
}

export function weightsSumToOne(weights: MCDAWeights, tolerance = 0.001): boolean {
  if (!CRITERION_KEYS.every((key) => Number.isFinite(weights[key]) && weights[key] >= 0 && weights[key] <= 1)) return false;
  const sum = weights.fuelCost + weights.travelTime;
  return Math.abs(sum - 1) <= tolerance;
}

/** Weighted-sum SAW over two cost-type criteria. Returns full breakdown per mode. */
export function evaluateModes(
  modes: ModeRawScores[],
  weights: MCDAWeights
): ModeEvaluation[] {
  if (!weightsSumToOne(weights)) throw new Error('Criterion weights must be between 0 and 1 and sum to 1.');
  if (modes.some((mode) => CRITERION_KEYS.some((key) => !Number.isFinite(mode[key]) || mode[key] < 0))) {
    throw new Error('Trip costs and travel times must be finite, non-negative numbers.');
  }
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
    };

    const weightedScore =
      normalized.fuelCost * weights.fuelCost + normalized.travelTime * weights.travelTime;

    return {
      modeCode: mode.modeCode,
      raw: {
        fuelCost: mode.fuelCost,
        travelTime: mode.travelTime,
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
