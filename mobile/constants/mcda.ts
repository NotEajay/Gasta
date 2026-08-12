import type { MCDAWeights } from '@/types/mcda';

/** Default criterion weights — must sum to 1. User-adjustable at trip time. */
export const DEFAULT_MCDA_WEIGHTS: MCDAWeights = {
  fuelCost: 0.5,
  travelTime: 0.3,
  depreciation: 0.2,
};

export const MCDA_CRITERIA = [
  { key: 'fuelCost' as const, label: 'Fuel Cost', direction: 'lower_is_better' as const },
  { key: 'travelTime' as const, label: 'Travel Time', direction: 'lower_is_better' as const },
  { key: 'depreciation' as const, label: 'Vehicle Depreciation', direction: 'lower_is_better' as const },
];
