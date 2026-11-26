import type { DoeFuelTypeCode } from './fuelTypes';

/** GasTa fuel labels: presentation only, independent of brand and price movement. */
export type FuelTypeColor = { strong: string; soft: string; border: string; text: string; onStrong: string };

export const FUEL_TYPE_COLORS = {
  RON_91: { strong: '#36735A', soft: '#EDF3EF', border: '#C8D8CD', text: '#166534', onStrong: '#FFFFFF' },
  RON_95: { strong: '#3E5FB5', soft: '#EFF2F8', border: '#D5DDEB', text: '#1D4ED8', onStrong: '#FFFFFF' },
  RON_97: { strong: '#7753A2', soft: '#F4F0F8', border: '#DED1EB', text: '#68498B', onStrong: '#FFFFFF' },
  RON_100: { strong: '#9D4160', soft: '#FAEFF3', border: '#EACDD6', text: '#853750', onStrong: '#FFFFFF' },
  DIESEL: { strong: '#EAB308', soft: '#FEFCE8', border: '#FDE68A', text: '#713F12', onStrong: '#192D42' },
  DIESEL_PLUS: { strong: '#75549B', soft: '#F2EFF6', border: '#D9D0E3', text: '#6D28D9', onStrong: '#FFFFFF' },
  KEROSENE: { strong: '#52677D', soft: '#EFF2F5', border: '#CDD6DF', text: '#475569', onStrong: '#FFFFFF' },
} satisfies Record<DoeFuelTypeCode, FuelTypeColor>;

const UNKNOWN_FUEL_COLOR: FuelTypeColor = { strong: '#566679', soft: '#EDF1F4', border: '#D5DDE5', text: '#46566A', onStrong: '#FFFFFF' };

export function getFuelTypeColor(code?: string | null): FuelTypeColor {
  return code && Object.prototype.hasOwnProperty.call(FUEL_TYPE_COLORS, code)
    ? FUEL_TYPE_COLORS[code as DoeFuelTypeCode] : UNKNOWN_FUEL_COLOR;
}
