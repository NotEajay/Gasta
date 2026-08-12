import { supabase } from '@/lib/supabase';
import type { Vehicle, VehicleCatalogEntry } from '@/types';

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
  return (data ?? []) as VehicleCatalogEntry[];
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
}

export async function createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
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
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteVehicle(vehicleId: string): Promise<void> {
  const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
  if (error) throw error;
}
