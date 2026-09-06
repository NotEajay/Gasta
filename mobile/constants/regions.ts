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

/**
 * City / area picks when a DOE bulletin has no per-city rows.
 * North Luzon PDFs often publish only region-wide brand mins (no AREA column).
 */
export const REGION_FALLBACK_CITIES: Record<DoeRegionCode, readonly string[]> = {
  NCR: [
    'Caloocan City',
    'Makati City',
    'Mandaluyong City',
    'Manila City',
    'Marikina City',
    'Pasay City',
    'Pasig City',
    'Quezon City',
    'Taguig City',
    'Paranaque City',
  ],
  NORTH_LUZON: [
    'Angeles City',
    'Baguio City',
    'Balanga City',
    'Cabanatuan City',
    'Dagupan City',
    'Laoag City',
    'Olongapo City',
    'San Fernando City',
    'Santiago City',
    'Tarlac City',
    'Tuguegarao City',
    'Vigan City',
  ],
  SOUTH_LUZON: [
    'Batangas City',
    'Calamba',
    'Bacoor',
    'Lipa City',
    'Lucena City',
    'Naga City',
    'Puerto Princesa City',
    'San Pablo City',
    'Sta. Rosa',
    'Tagaytay City',
  ],
  VISAYAS: [
    'Bacolod City',
    'Cebu City',
    'Iloilo City',
    'Mandaue City',
    'Ormoc City',
    'Roxas City',
    'Tacloban City',
    'Tagbilaran City',
  ],
  MINDANAO: [
    'Butuan City',
    'Cagayan de Oro City',
    'Davao City',
    'General Santos City',
    'Iligan City',
    'Surigao City',
    'Zamboanga City',
  ],
};
