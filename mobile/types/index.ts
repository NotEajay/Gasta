import type { DoeFuelTypeCode } from '@/constants/fuelTypes';
import type { DoeRegionCode } from '@/constants/regions';
import type { TransportModeCode } from '@/constants/transportModes';

export interface Region {
  id: string;
  code: DoeRegionCode;
  name: string;
  created_at: string;
}

export interface FuelType {
  id: string;
  code: DoeFuelTypeCode;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface OilCompany {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface FuelPriceBulletin {
  id: string;
  bulletin_date: string;
  source_pdf_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface FuelPrice {
  id: string;
  bulletin_id: string;
  region_id: string;
  oil_company_id: string;
  fuel_type_id: string;
  price_per_liter: number;
  created_at: string;
}

export interface VehicleCatalogEntry {
  id: string;
  brand: string;
  model: string;
  year: number;
  fuel_type_id: string;
  fuel_efficiency_km_per_liter: number;
  created_at: string;
  fuel_type?: { code: string; name: string };
}

/**
 * Access roles for a shared vehicle. The Owner is NOT one of these — ownership
 * stays structural in vehicles.user_id and never appears in vehicle_shares.
 */
export type VehicleShareRole = 'Member' | 'Driver' | 'Operator' | 'Viewer';

export const VEHICLE_SHARE_ROLES: readonly VehicleShareRole[] = [
  'Member',
  'Driver',
  'Operator',
  'Viewer',
];

/** Roles that may create/edit/void refills. Viewer is deliberately absent. */
export const REFUILL_WRITE_ROLES: readonly VehicleShareRole[] = [
  'Member',
  'Driver',
  'Operator',
];

/** Plain-English meaning shown under the role selector. */
export const VEHICLE_SHARE_ROLE_DESCRIPTIONS: Record<VehicleShareRole, string> = {
  Member: 'Regular shared access for someone who also uses this vehicle.',
  Driver: 'For someone who drives this vehicle on behalf of the owner or as part of their work.',
  Operator: 'For someone who helps manage the vehicle’s day-to-day operations.',
  Viewer: 'Can view shared vehicle information and history only.',
};

/**
 * A real refuelling event (migration 20240812000014). One row per refill, shared
 * by every member of the vehicle.
 *
 * Declared as a `type` (not `interface`) on purpose: only type aliases get an
 * implicit index signature, which is what lets it satisfy the supabase-js
 * GenericTable constraint. types/database.ts is generated and is NOT hand-edited.
 */
export type VehicleRefill = {
  id: string;
  vehicle_id: string;
  total_amount: number;
  price_per_liter: number;
  liters: number | null;
  fuel_type_id: string | null;
  logged_by: string;
  paid_by: string;
  occurred_at: string;
  notes: string | null;
  receipt_ref: string | null;
  voided_at: string | null;
  voided_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VehicleMemberRole = 'Owner' | VehicleShareRole;

/** Returned by the vehicle_members(uuid) RPC — the only valid `paid_by` choices. */
export type VehicleMember = {
  user_id: string;
  full_name: string | null;
  role: VehicleMemberRole;
};

export interface UserProfile {
  id: string;
  full_name: string | null;
  email: string | null;
}

export interface UserProfileLookup {
  id: string;
  full_name: string | null;
}

export interface VehicleShare {
  ShareID: string;
  vehicleID: string;
  shared_by: string;
  shared_with: string;
  role: VehicleShareRole;
  created_at: string;
  revoked: boolean;
}

export type SharedVehicle = {
  vehicleId: string;
  brand: string;
  model: string;
  /** Real fuel type from the vehicle row, so shared refills record it correctly. */
  fuelTypeId: string | null;
  role: VehicleShareRole;
};

export interface Vehicle {
  id: string;
  user_id: string;
  catalog_id: string | null;
  brand: string;
  model: string;
  year: number;
  fuel_type_id: string;
  fuel_efficiency_km_per_liter: number;
  nickname: string | null;
  last_refill_price: number | null;
  last_refill_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransportMode {
  id: string;
  code: TransportModeCode;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface FuelBudget {
  id: string;
  user_id: string;
  year: number;
  month: number;
  limit_amount: number;
  alert_threshold_percent: number;
  created_at: string;
  updated_at: string;
}

export interface SavedTrip {
  id: string;
  user_id: string;
  name: string;
  origin_label: string | null;
  destination_label: string | null;
  vehicle_id: string | null;
  distance_km: number;
  mcda_weights: import('./mcda').MCDAWeights;
  created_at: string;
  updated_at: string;
}

export type { MCDAWeights, ModeEvaluation, TripRecord } from './mcda';
