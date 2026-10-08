import type { ImageSourcePropType } from 'react-native';

import { getBrandLogo } from '@/constants/brandLogos';

export type FuelBrandVisual = {
  key: string;
  label: string;
  initials: string;
  color: string;
  logo?: ImageSourcePropType;
};

const KNOWN_BRANDS: Array<{ key: string; label: string; color: string; terms: string[] }> = [
  { key: 'caltex', label: 'Caltex', color: '#EA580C', terms: ['caltex'] },
  { key: 'petron', label: 'Petron', color: '#2563EB', terms: ['petron'] },
  { key: 'shell', label: 'Shell', color: '#CA8A04', terms: ['shell'] },
  {
    key: 'flying-v',
    label: 'Flying V',
    color: '#DC2626',
    terms: ['flying v', 'flying-v', 'flyingv'],
  },
  { key: 'seaoil', label: 'Seaoil', color: '#2E7D32', terms: ['seaoil', 'sea oil'] },
  {
    key: 'cleanfuel',
    label: 'Cleanfuel',
    color: '#0F766E',
    terms: ['cleanfuel', 'clean fuel'],
  },
  { key: 'phoenix', label: 'Phoenix', color: '#DC2626', terms: ['phoenix'] },
  { key: 'unioil', label: 'UniOil', color: '#64748B', terms: ['unioil', 'uni oil'] },
  { key: 'total', label: 'Total', color: '#0284C7', terms: ['total'] },
  { key: 'ptt', label: 'PTT', color: '#7C3AED', terms: ['ptt'] },
  { key: 'jetti', label: 'Jetti', color: '#0369A1', terms: ['jetti'] },
];

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function initials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0]?.slice(0, 2) || 'GS').toUpperCase();
}

export function getFuelBrandVisual(
  brandOrStation: string | null | undefined,
  slug?: string | null
): FuelBrandVisual {
  const source = normalize(slug) || normalize(brandOrStation);
  const match =
    KNOWN_BRANDS.find(
      (brand) => source === brand.key || brand.terms.some((term) => source.includes(term))
    ) ??
    KNOWN_BRANDS.find((brand) =>
      brand.terms.some((term) => normalize(brandOrStation).includes(term))
    );
  const label = match?.label ?? brandOrStation?.trim() ?? 'GasTa station';
  const fallbackKey = normalize(brandOrStation).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const key = match?.key ?? (fallbackKey || 'station');

  return {
    key,
    label,
    initials: initials(match?.label ?? label),
    color: match?.color ?? '#014421',
    logo: getBrandLogo(key),
  };
}
