import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { supabase } from '@/lib/supabase';

/** Vehicles and DOE prices reference the same fuel_types rows. Never guess aliases. */
export async function resolveVehicleFuel(
  fuelTypeId: string | null | undefined,
): Promise<{ code: DoeFuelTypeCode; name: string } | null> {
  if (!fuelTypeId) return null;
  const { data, error } = await supabase.from('fuel_types')
    .select('id, code, name').eq('id', fuelTypeId).maybeSingle();
  if (error) throw error;
  const fuel = DOE_FUEL_TYPES.find((entry) => entry.code === data?.code);
  return fuel ? { code: fuel.code, name: data?.name ?? fuel.name } : null;
}
