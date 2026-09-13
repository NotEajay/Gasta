import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { ModeEvaluation, MCDAWeights, TripRecord } from '@/types/mcda';
import type { TransportModeCode } from '@/constants/transportModes';

export interface LogTripHistoryInput {
  userId: string;
  vehicleId: string | null;
  distanceKm: number;
  originLabel?: string;
  destinationLabel?: string;
  weights: MCDAWeights;
  evaluations: ModeEvaluation[];
  recommendedModeCode: TransportModeCode;
}

/** Append a completed SAW run to trip history (trip_records). */
export async function logTripToHistory(input: LogTripHistoryInput) {
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

/** @deprecated Use logTripToHistory */
export const saveTripRecord = logTripToHistory;

function parseTripRecord(row: {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  distance_km: number;
  origin_label: string | null;
  destination_label: string | null;
  mcda_weights: Json;
  mode_evaluations: Json;
  recommended_mode_code: string;
  created_at: string;
}): TripRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    vehicle_id: row.vehicle_id,
    distance_km: row.distance_km,
    origin_label: row.origin_label,
    destination_label: row.destination_label,
    mcda_weights: row.mcda_weights as unknown as MCDAWeights,
    mode_evaluations: row.mode_evaluations as unknown as ModeEvaluation[],
    recommended_mode_code: row.recommended_mode_code as TransportModeCode,
    created_at: row.created_at,
  };
}

export async function fetchRecentTrips(userId: string, limit = 50): Promise<TripRecord[]> {
  const { data, error } = await supabase
    .from('trip_records')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(parseTripRecord);
}

export async function deleteTripRecord(tripRecordId: string): Promise<void> {
  const { error } = await supabase.from('trip_records').delete().eq('id', tripRecordId);
  if (error) throw error;
}
