import type { MCDAWeights } from '@/types/mcda';

/** Default SAW criterion weights — must sum to 1. User-adjustable at trip time. */
export const DEFAULT_MCDA_WEIGHTS: MCDAWeights = {
  fuelCost: 0.6,
  travelTime: 0.4,
};

/** Alias for SAW terminology (`mcda_*` names kept for `trip_records` JSONB columns). */
export const DEFAULT_SAW_WEIGHTS = DEFAULT_MCDA_WEIGHTS;

export const MCDA_CRITERIA = [
  { key: 'fuelCost' as const, label: 'Fuel Cost', direction: 'lower_is_better' as const },
  { key: 'travelTime' as const, label: 'Travel Time', direction: 'lower_is_better' as const },
];

/** Alias for SAW terminology. */
export const SAW_CRITERIA = MCDA_CRITERIA;
