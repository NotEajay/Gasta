import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';
import type { SavedTrip } from '@/types';
import type { MCDAWeights } from '@/types/mcda';

export interface CreateSavedTripInput {
  userId: string;
  name: string;
  originLabel?: string;
  destinationLabel?: string;
  vehicleId: string | null;
  distanceKm: number;
  weights: MCDAWeights;
}

export async function fetchSavedTrips(userId: string): Promise<SavedTrip[]> {
  const { data, error } = await supabase
    .from('saved_trips')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    mcda_weights: row.mcda_weights as unknown as MCDAWeights,
  }));
}

export async function createSavedTrip(input: CreateSavedTripInput): Promise<SavedTrip> {
  // New saved-trip selection never offers archived vehicles; this guards
  // stale in-memory state the same way the refill guard does.
  if (input.vehicleId) await assertVehicleActive(input.vehicleId);
  const { data, error } = await supabase
    .from('saved_trips')
    .insert({
      user_id: input.userId,
      name: input.name,
      origin_label: input.originLabel ?? null,
      destination_label: input.destinationLabel ?? null,
      vehicle_id: input.vehicleId,
      distance_km: input.distanceKm,
      mcda_weights: input.weights as unknown as Json,
    })
    .select('*')
    .single();

  if (error) throw error;
  return {
    ...data,
    mcda_weights: data.mcda_weights as unknown as MCDAWeights,
  };
}

export async function deleteSavedTrip(savedTripId: string): Promise<void> {
  const { error } = await supabase.from('saved_trips').delete().eq('id', savedTripId);
  if (error) throw error;
}

async function assertVehicleActive(vehicleId: string): Promise<void> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, archived_at')
    .eq('id', vehicleId)
    .maybeSingle();
  if (error) {
    if (error.code === '42703' || /archived_at/i.test(error.message)) return;
    return;
  }
  const archivedAt = (data as { archived_at?: string | null } | null)?.archived_at ?? null;
  if (archivedAt != null) {
    throw new Error('This vehicle is archived. Restore it before using it for new trips.');
  }
}
