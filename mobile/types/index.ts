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

export type { MCDAWeights, ModeEvaluation, TripRecord } from './mcda';
