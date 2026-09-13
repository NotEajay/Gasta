import type { TransportModeCode } from '@/constants/transportModes';

/** Two SAW criteria — weights must sum to 1. */
export interface MCDAWeights {
  fuelCost: number;
  travelTime: number;
}

/** Raw and normalized values plus weighted score for one transport mode. */
export interface ModeEvaluation {
  modeCode: TransportModeCode;
  raw: {
    fuelCost: number;
    travelTime: number;
  };
  normalized: {
    fuelCost: number;
    travelTime: number;
  };
  weightedScore: number;
}

/** Full trip record with auditable SAW breakdown (matches trip_records.mode_evaluations). */
export interface TripRecord {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  distance_km: number;
  origin_label: string | null;
  destination_label: string | null;
  mcda_weights: MCDAWeights;
  mode_evaluations: ModeEvaluation[];
  recommended_mode_code: TransportModeCode;
  created_at: string;
}

export type MCDACriterionKey = keyof MCDAWeights;
