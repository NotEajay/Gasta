import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// Narrow adapter until generated Database types include migration 20261022000000.
interface DefaultVehicleDatabase {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; default_vehicle_id: string | null };
        Insert: { id: string; default_vehicle_id?: string | null };
        Update: { default_vehicle_id?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: { set_default_vehicle: { Args: { p_vehicle_id: string }; Returns: string } };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
const db = supabase as unknown as SupabaseClient<DefaultVehicleDatabase>;

export const DEFAULT_VEHICLE_MIGRATION_MESSAGE =
  'Default vehicle is unavailable. Apply migration 20261022000000_default_vehicle to enable it.';

export async function fetchDefaultVehicleId(userId: string): Promise<string | null> {
  const { data, error } = await db.from('profiles').select('default_vehicle_id')
    .eq('id', userId).maybeSingle();
  // Existing installations remain usable until the additive migration is applied.
  if (error && (error.code === '42703' || error.code === 'PGRST204')) return null;
  if (error) throw error;
  return data?.default_vehicle_id ?? null;
}

export async function setDefaultVehicle(vehicleId: string): Promise<string> {
  const { data, error } = await db.rpc('set_default_vehicle', { p_vehicle_id: vehicleId });
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new Error(DEFAULT_VEHICLE_MIGRATION_MESSAGE);
    }
    if (error.code === '42501' || error.code === '23514' || error.code === '23503') {
      throw new Error('Choose an active vehicle you own.');
    }
    throw new Error('Could not save your default vehicle. Please try again.');
  }
  if (!data) throw new Error('Could not save your default vehicle. Please try again.');
  return data;
}
