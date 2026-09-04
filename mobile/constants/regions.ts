/** DOE weekly bulletin regions — five pricing areas in the Philippines. */

export const DOE_REGIONS = [
  { code: 'NCR', name: 'National Capital Region' },
  { code: 'NORTH_LUZON', name: 'North Luzon' },
  { code: 'SOUTH_LUZON', name: 'South Luzon' },
  { code: 'VISAYAS', name: 'Visayas' },
  { code: 'MINDANAO', name: 'Mindanao' },
] as const;

export type DoeRegionCode = (typeof DOE_REGIONS)[number]['code'];

/** Approximate centroids used when creating a station without a map pin. */
export const REGION_CENTROIDS: Record<DoeRegionCode, { latitude: number; longitude: number }> = {
  NCR: { latitude: 14.5995, longitude: 120.9842 },
  NORTH_LUZON: { latitude: 16.4023, longitude: 120.596 },
  SOUTH_LUZON: { latitude: 14.152, longitude: 121.15 },
  VISAYAS: { latitude: 10.3157, longitude: 123.8854 },
  MINDANAO: { latitude: 7.1907, longitude: 125.4553 },
};
