import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type {
  UserProfile,
  UserProfileLookup,
  SharedVehicle,
  Vehicle,
  VehicleCatalogEntry,
  VehicleShare,
  VehicleShareRole,
} from '@/types';

/**
 * restore_vehicle_share() comes from 20240812000022, which has NOT been pushed
 * to the live project, so the generated Database type does not know it yet. This
 * tiny adapter types just that one call, keeping it fully typed without
 * hand-editing the generated file. Delete once `supabase gen types` is re-run.
 */
interface ShareFunctionsDatabase {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      restore_vehicle_share: {
        Args: { p_vehicle_id: string; p_user_id: string; p_role: string };
        Returns: VehicleShare;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const shareDb = supabase as unknown as SupabaseClient<ShareFunctionsDatabase>;

const shareColumns = '"ShareID", "vehicleID", shared_by, shared_with, role, created_at, revoked';

export async function findUserByEmail(email: string): Promise<UserProfileLookup | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase
    .rpc('find_user_by_email', { lookup_email: normalizedEmail })
    .maybeSingle();

  if (error) throw error;
  return (data as UserProfileLookup | null) ?? null;
}

export async function fetchUserProfileById(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data as UserProfile | null) ?? null;
}

/**
 * Owner-management query: every share row for this vehicle, ACTIVE *AND* REVOKED.
 *
 * This must NOT filter on `revoked`. The Share form uses this list to tell three
 * states apart — never shared, currently active, previously revoked — so it can
 * offer "Restore access" and reactivate the existing row instead of inserting a
 * second one. With a `revoked = false` filter a revoked collaborator looks brand
 * new, the form falls through to createVehicleShare(), and the insert dies on
 * unique (vehicleID, shared_with) with 23505.
 *
 * Contrast fetchSharedVehicles(), which is the recipient's view and correctly
 * returns active rows only.
 */
export async function fetchVehicleShares(
  vehicleId: string,
  ownerId: string,
): Promise<VehicleShare[]> {
  const { data, error } = await supabase
    .from('vehicle_shares')
    .select(shareColumns)
    .eq('vehicleID', vehicleId)
    .eq('shared_by', ownerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as VehicleShare[];
}

export async function fetchSharedVehicles(userId: string): Promise<SharedVehicle[]> {
  const { data: shareData, error: shareError } = await supabase
    .from('vehicle_shares')
    .select('"vehicleID", role')
    .eq('shared_with', userId)
    .eq('revoked', false)
    .order('created_at', { ascending: false });

  if (shareError) throw shareError;

  const shares = (shareData ?? []) as unknown as Array<Pick<VehicleShare, 'vehicleID' | 'role'>>;
  if (shares.length === 0) return [];

  const vehicleIds = [...new Set(shares.map((share) => share.vehicleID))];
  const { data: vehicleData, error: vehicleError } = await supabase
    .from('vehicles')
    // fuel_type_id is included so a Member/Driver/Operator can log a refill for a
    // shared vehicle with the correct fuel type. vehicles_select_shared already
    // grants the whole row to active share recipients, so this needs no policy
    // change and exposes nothing new.
    .select('id, brand, model, fuel_type_id')
    .in('id', vehicleIds);

  if (vehicleError) throw vehicleError;

  const vehiclesById = new Map((vehicleData ?? []).map((vehicle) => [vehicle.id, vehicle]));

  return shares.flatMap((share) => {
    const vehicle = vehiclesById.get(share.vehicleID);
    if (!vehicle) return [];

    return [
      {
        vehicleId: share.vehicleID,
        brand: vehicle.brand,
        model: vehicle.model,
        fuelTypeId: vehicle.fuel_type_id,
        role: share.role,
      },
    ];
  });
}

export interface CreateVehicleShareInput {
  vehicleId: string;
  sharedBy: string;
  sharedWith: string;
  role: VehicleShareRole;
}

export async function createVehicleShare(input: CreateVehicleShareInput): Promise<VehicleShare> {
  const { data, error } = await supabase
    .from('vehicle_shares')
    .insert({
      vehicleID: input.vehicleId,
      shared_by: input.sharedBy,
      shared_with: input.sharedWith,
      role: input.role,
    })
    .select(shareColumns)
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('This vehicle is already shared with that user.');
    }
    throw error;
  }

  if (!data) {
    throw new Error('Unable to create the vehicle share.');
  }

  return data as unknown as VehicleShare;
}

export async function revokeVehicleShare(
  shareId: string,
  vehicleId: string,
  ownerId: string,
): Promise<void> {
  const { error } = await supabase
    .from('vehicle_shares')
    .update({ revoked: true })
    .eq('ShareID', shareId)
    .eq('vehicleID', vehicleId)
    .eq('shared_by', ownerId)
    .eq('revoked', false);

  if (error) throw error;
}

/**
 * Re-grant access to a previously revoked collaborator, on the SAME vehicle_shares
 * row (unique on vehicleID + shared_with, so a second INSERT is impossible).
 * Ownership and the role vocabulary are re-verified server-side.
 */
export async function restoreVehicleShare(
  vehicleId: string,
  userId: string,
  role: VehicleShareRole,
): Promise<VehicleShare> {
  const { data, error } = await shareDb
    .rpc('restore_vehicle_share', {
      p_vehicle_id: vehicleId,
      p_user_id: userId,
      p_role: role,
    })
    .single();

  if (error) {
    // 42883 = undefined_function. The RPC ships in migration
    // 20240812000022; if it has not been applied to the project yet, PostgREST
    // fails here. Say so plainly instead of surfacing a raw driver error.
    if (error.code === '42883' || /restore_vehicle_share/i.test(error.message)) {
      throw new Error(
        'Restore access is unavailable: the restore_vehicle_share function is not deployed. Apply migration 20240812000022.',
      );
    }
    throw error;
  }
  return data as unknown as VehicleShare;
}

export async function fetchVehicles(userId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchVehicleCatalog(): Promise<VehicleCatalogEntry[]> {
  const { data, error } = await supabase
    .from('vehicle_catalog')
    .select('*, fuel_type:fuel_types ( code, name )')
    .order('brand')
    .order('model');

  if (error) throw error;
  return (data ?? []) as unknown as VehicleCatalogEntry[];
}

export async function fetchFuelTypeIdByCode(code: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('fuel_types')
    .select('id')
    .eq('code', code)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export interface CreateVehicleInput {
  userId: string;
  catalogId?: string | null;
  brand: string;
  model: string;
  year: number;
  fuelTypeId: string;
  fuelEfficiencyKmPerLiter: number;
  nickname?: string;
  lastRefillPrice?: number;
}

export async function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
  const hasLastRefill = input.lastRefillPrice != null && input.lastRefillPrice > 0;

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      user_id: input.userId,
      catalog_id: input.catalogId ?? null,
      brand: input.brand,
      model: input.model,
      year: input.year,
      fuel_type_id: input.fuelTypeId,
      fuel_efficiency_km_per_liter: input.fuelEfficiencyKmPerLiter,
      nickname: input.nickname ?? null,
      last_refill_price: hasLastRefill ? input.lastRefillPrice : null,
      last_refill_at: hasLastRefill ? new Date().toISOString() : null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateVehicleLastRefill(
  vehicleId: string,
  lastRefillPrice: number,
): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .update({
      last_refill_price: lastRefillPrice,
      last_refill_at: new Date().toISOString(),
    })
    .eq('id', vehicleId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export interface UpdateVehicleInput {
  vehicleId: string;
  brand: string;
  model: string;
  year: number;
  fuelTypeId: string;
  fuelEfficiencyKmPerLiter: number;
  nickname: string;
  lastRefillPrice?: number;
}

export async function updateVehicle(input: UpdateVehicleInput): Promise<Vehicle> {
  const hasLastRefill = input.lastRefillPrice != null && input.lastRefillPrice > 0;

  const { data, error } = await supabase
    .from('vehicles')
    .update({
      brand: input.brand,
      model: input.model,
      year: input.year,
      fuel_type_id: input.fuelTypeId,
      fuel_efficiency_km_per_liter: input.fuelEfficiencyKmPerLiter,
      nickname: input.nickname,
      last_refill_price: hasLastRefill ? input.lastRefillPrice : null,
      last_refill_at: hasLastRefill ? new Date().toISOString() : null,
    })
    .eq('id', input.vehicleId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteVehicle(vehicleId: string): Promise<void> {
  const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
  if (error) throw error;
}
