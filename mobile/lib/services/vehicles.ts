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

export async function fetchVehicleShares(
  vehicleId: string,
  ownerId: string,
): Promise<VehicleShare[]> {
  const { data, error } = await supabase
    .from('vehicle_shares')
    .select(shareColumns)
    .eq('vehicleID', vehicleId)
    .eq('shared_by', ownerId)
    .eq('revoked', false)
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

  const shares = (shareData ?? []) as unknown as Array<
    Pick<VehicleShare, 'vehicleID' | 'role'>
  >;
  if (shares.length === 0) return [];

  const vehicleIds = [...new Set(shares.map((share) => share.vehicleID))];
  const { data: vehicleData, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, brand, model')
    .in('id', vehicleIds);

  if (vehicleError) throw vehicleError;

  const vehiclesById = new Map(
    (vehicleData ?? []).map((vehicle) => [vehicle.id, vehicle]),
  );

  return shares.flatMap((share) => {
    const vehicle = vehiclesById.get(share.vehicleID);
    if (!vehicle) return [];

    return [
      {
        vehicleId: share.vehicleID,
        brand: vehicle.brand,
        model: vehicle.model,
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
      "vehicleID": input.vehicleId,
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
  lastRefillPrice: number
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
