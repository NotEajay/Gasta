import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { FUEL_TYPE_COLORS as COLORS, getFuelTypeColor } from '@/constants/fuelTypeColors';

/** Shared fuel identity for cards, filters, badges and charts. */
export const FUEL_TYPE_COLORS = Object.fromEntries(
  Object.entries(COLORS).map(([code, tone]) => [code, {
    accent: tone.strong, softBackground: tone.soft, cardBackground: tone.strong,
  }]),
) as Record<DoeFuelTypeCode, { accent: string; softBackground: string; cardBackground: string }>;
const neutral = getFuelTypeColor(null);
const NEUTRAL = { accent: neutral.strong, softBackground: neutral.soft, cardBackground: neutral.strong };
const safeLabel = (value: unknown) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
const GASOLINE_LABELS: Partial<Record<DoeFuelTypeCode, string>> = {
  RON_91: 'Regular Unleaded',
  RON_95: 'Premium Unleaded',
  RON_97: 'Premium Unleaded',
  RON_100: 'Premium Unleaded',
};

export function getFuelTypePresentation(code: string | null | undefined, label?: string | null): {
  code: DoeFuelTypeCode | null; label: string; primaryLabel: string; subtitle: string | null; accent: string; softBackground: string; cardBackground: string;
} {
  // Exact canonical lookup, shared with the existing fuel definitions. No aliases
  // or guesses about legacy/product names are introduced by presentation.
  const fuel = DOE_FUEL_TYPES.find((entry) => entry.code === code);
  const fallback = safeLabel(label) || safeLabel(code) || 'Fuel';
  return fuel ? { code: fuel.code, label: fuel.name, primaryLabel: GASOLINE_LABELS[fuel.code] ?? fuel.name,
    subtitle: GASOLINE_LABELS[fuel.code] ? fuel.name : null, ...FUEL_TYPE_COLORS[fuel.code] }
    : { code: null, label: fallback, primaryLabel: fallback, subtitle: null, ...NEUTRAL };
}
