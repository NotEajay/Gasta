/** Fuel types published in DOE weekly price bulletins. */

export const DOE_FUEL_TYPES = [
  { code: 'RON_91', name: 'RON 91' },
  { code: 'RON_95', name: 'RON 95' },
  { code: 'RON_97', name: 'RON 97' },
  { code: 'RON_100', name: 'RON 100' },
  { code: 'DIESEL', name: 'Diesel' },
  { code: 'DIESEL_PLUS', name: 'Diesel Plus' },
  { code: 'KEROSENE', name: 'Kerosene' },
] as const;

export type DoeFuelTypeCode = (typeof DOE_FUEL_TYPES)[number]['code'];
