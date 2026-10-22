import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';

/** Fuel identity only; independent of price movement, verification and branding. */
export const FUEL_TYPE_COLORS = {
  RON_91: { accent: '#3B82F6', softBackground: '#EAF2FF', cardBackground: '#1D4F91' },
  RON_95: { accent: '#7C5CE7', softBackground: '#F0ECFD', cardBackground: '#523A9C' },
  RON_97: { accent: '#D69A22', softBackground: '#FFF3D9', cardBackground: '#8B5D12' },
  RON_100: { accent: '#B84A7A', softBackground: '#F9E8F0', cardBackground: '#7A3154' },
  DIESEL: { accent: '#2F855A', softBackground: '#E7F4EC', cardBackground: '#245E43' },
  DIESEL_PLUS: { accent: '#0F8C8C', softBackground: '#E5F5F5', cardBackground: '#0A6267' },
  KEROSENE: { accent: '#64748B', softBackground: '#EEF1F4', cardBackground: '#445266' },
} as const satisfies Record<DoeFuelTypeCode, { accent: string; softBackground: string; cardBackground: string }>;

const NEUTRAL = { accent: '#64748B', softBackground: '#EEF1F4', cardBackground: '#445266' };
const safeLabel = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';

export function getFuelTypePresentation(code: string | null | undefined, label?: string | null): {
  code: DoeFuelTypeCode | null; label: string; accent: string; softBackground: string; cardBackground: string;
} {
  // Exact canonical lookup, shared with the existing fuel definitions. No aliases
  // or guesses about legacy/product names are introduced by presentation.
  const fuel = DOE_FUEL_TYPES.find((entry) => entry.code === code);
  return fuel ? { code: fuel.code, label: fuel.name, ...FUEL_TYPE_COLORS[fuel.code] }
    : { code: null, label: safeLabel(label) || safeLabel(code) || 'Fuel', ...NEUTRAL };
}
