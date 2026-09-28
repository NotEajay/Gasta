import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { VehicleMember, VehicleRefill } from '@/types';

type VehicleRefillInsert = Omit<
  VehicleRefill,
  'id' | 'created_at' | 'updated_at' | 'voided_at' | 'voided_by'
> &
  Partial<Pick<VehicleRefill, 'voided_at' | 'voided_by'>>;

/**
 * `vehicle_refills` and `vehicle_members()` come from migrations
 * 20240812000014-17, which have NOT been pushed to the live project, so the
 * generated Database type does not know them yet. This small standalone schema
 * types exactly the two objects this service touches, keeping every call fully
 * typed without hand-editing the generated file. Delete this adapter once
 * `supabase gen types` has been re-run.
 */
interface RefillDatabase {
  public: {
    Tables: {
      vehicle_refills: {
        Row: VehicleRefill;
        Insert: VehicleRefillInsert;
        Update: Partial<VehicleRefill>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      vehicle_members: {
        Args: { p_vehicle_id: string };
        Returns: VehicleMember[];
      };
      void_vehicle_refill: {
        Args: { p_refill_id: string };
        Returns: VehicleRefill;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const db = supabase as unknown as SupabaseClient<RefillDatabase>;

/** Valid `paid_by` choices: the owner plus every active share, Viewer included. */
export async function fetchVehicleMembers(vehicleId: string): Promise<VehicleMember[]> {
  const { data, error } = await db.rpc('vehicle_members', { p_vehicle_id: vehicleId });
  if (error) throw error;
  return data ?? [];
}

export async function fetchVehicleRefills(vehicleId: string): Promise<VehicleRefill[]> {
  const { data, error } = await db
    .from('vehicle_refills')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface CreateRefillInput {
  vehicleId: string;
  totalAmount: number;
  pricePerLiter: number;
  liters: number | null;
  fuelTypeId: string | null;
  /** Always the signed-in user. RLS rejects anything else. */
  loggedBy: string;
  paidBy: string;
  occurredAt: string;
  notes: string | null;
  receiptRef: string | null;
}

export async function createVehicleRefill(input: CreateRefillInput): Promise<VehicleRefill> {
  const { data, error } = await db
    .from('vehicle_refills')
    .insert({
      vehicle_id: input.vehicleId,
      total_amount: input.totalAmount,
      price_per_liter: input.pricePerLiter,
      liters: input.liters,
      fuel_type_id: input.fuelTypeId,
      logged_by: input.loggedBy,
      paid_by: input.paidBy,
      occurred_at: input.occurredAt,
      notes: input.notes,
      receipt_ref: input.receiptRef,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export interface UpdateRefillInput {
  refillId: string;
  totalAmount: number;
  pricePerLiter: number;
  liters: number | null;
  paidBy: string;
  occurredAt: string;
  notes: string | null;
  receiptRef: string | null;
}

export async function updateVehicleRefill(input: UpdateRefillInput): Promise<VehicleRefill> {
  const { data, error } = await db
    .from('vehicle_refills')
    .update({
      total_amount: input.totalAmount,
      price_per_liter: input.pricePerLiter,
      liters: input.liters,
      paid_by: input.paidBy,
      occurred_at: input.occurredAt,
      notes: input.notes,
      receipt_ref: input.receiptRef,
    })
    .eq('id', input.refillId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Soft void via the server-side RPC. A direct client UPDATE cannot void a row
 * because the SELECT policy hides voided rows — see migration
 * 20240812000018_vehicle_refills_void_rpc.sql.
 */
export async function voidVehicleRefill(refillId: string): Promise<VehicleRefill> {
  const { data, error } = await db.rpc('void_vehicle_refill', { p_refill_id: refillId });
  if (error) throw error;
  return data;
}
