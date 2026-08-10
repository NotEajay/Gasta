/** Core domain types for GasTa! (see senior project manuscript Ch. 3). */

export type FuelType = 'gasoline' | 'diesel' | 'premium_gasoline';

export interface FuelPriceRecord {
  id: string;
  fuelType: FuelType;
  oilCompany: string;
  price: number;
  region: string;
  bulletinDate: string;
}

export interface VehicleProfile {
  id: string;
  userId: string;
  brand: string;
  model: string;
  fuelEfficiencyKmPerLiter: number;
}

export interface TripCostCalculation {
  mode: string;
  fuelCost: number;
  travelTimeMinutes: number;
  score: number;
}
