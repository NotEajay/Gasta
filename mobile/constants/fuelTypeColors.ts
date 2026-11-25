import type { DoeFuelTypeCode } from './fuelTypes';

/** GasTa fuel labels: presentation only, independent of brand and price movement. */
export type FuelTypeColor = { strong: string; soft: string; border: string; text: string; onStrong: string };

export const FUEL_TYPE_COLORS = {
  RON_91: { strong: '#24724F', soft: '#EDF6F0', border: '#C6DFD0', text: '#225B42', onStrong: '#FFFFFF' },
  RON_95: { strong: '#3E5FB5', soft: '#EFF2FA', border: '#D0D9EE', text: '#365397', onStrong: '#FFFFFF' },
  RON_97: { strong: '#7753A2', soft: '#F4F0F8', border: '#DED1EB', text: '#68498B', onStrong: '#FFFFFF' },
  RON_100: { strong: '#9D4160', soft: '#FAEFF3', border: '#EACDD6', text: '#853750', onStrong: '#FFFFFF' },
  DIESEL: { strong: '#94620F', soft: '#FCF4E5', border: '#E8D6AC', text: '#80530B', onStrong: '#FFFFFF' },
  DIESEL_PLUS: { strong: '#A14C26', soft: '#FAF0E9', border: '#E7CAB8', text: '#8B4122', onStrong: '#FFFFFF' },
  KEROSENE: { strong: '#2B6B80', soft: '#EDF5F7', border: '#C4DDE4', text: '#245A6C', onStrong: '#FFFFFF' },
} satisfies Record<DoeFuelTypeCode, FuelTypeColor>;

const UNKNOWN_FUEL_COLOR: FuelTypeColor = { strong: '#566679', soft: '#EDF1F4', border: '#D5DDE5', text: '#46566A', onStrong: '#FFFFFF' };

export function getFuelTypeColor(code?: string | null): FuelTypeColor {
  return code && Object.prototype.hasOwnProperty.call(FUEL_TYPE_COLORS, code)
    ? FUEL_TYPE_COLORS[code as DoeFuelTypeCode] : UNKNOWN_FUEL_COLOR;
}
