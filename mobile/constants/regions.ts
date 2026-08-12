/** DOE weekly bulletin regions — five pricing areas in the Philippines. */

export const DOE_REGIONS = [
  { code: 'NCR', name: 'National Capital Region' },
  { code: 'NORTH_LUZON', name: 'North Luzon' },
  { code: 'SOUTH_LUZON', name: 'South Luzon' },
  { code: 'VISAYAS', name: 'Visayas' },
  { code: 'MINDANAO', name: 'Mindanao' },
] as const;

export type DoeRegionCode = (typeof DOE_REGIONS)[number]['code'];
