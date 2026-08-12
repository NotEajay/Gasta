import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { ModeEvaluation, MCDAWeights } from '@/types/mcda';
import type { TransportModeCode } from '@/constants/transportModes';

export interface SaveTripInput {
  userId: string;
  vehicleId: string | null;
  distanceKm: number;
  originLabel?: string;
  destinationLabel?: string;
  weights: MCDAWeights;
  evaluations: ModeEvaluation[];
  recommendedModeCode: TransportModeCode;
}

export async function saveTripRecord(input: SaveTripInput) {
  const { data, error } = await supabase
    .from('trip_records')
    .insert({
      user_id: input.userId,
      vehicle_id: input.vehicleId,
      distance_km: input.distanceKm,
      origin_label: input.originLabel ?? null,
      destination_label: input.destinationLabel ?? null,
      mcda_weights: input.weights as unknown as Json,
      mode_evaluations: input.evaluations as unknown as Json,
      recommended_mode_code: input.recommendedModeCode,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function fetchRecentTrips(userId: string, limit = 10) {
  const { data, error } = await supabase
    .from('trip_records')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
