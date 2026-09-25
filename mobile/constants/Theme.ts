import type { TextStyle, ViewStyle } from 'react-native';

export const BrandColors = {
  navy: '#14315C',
  green: '#4CAF50',
  gold: '#F5A623',
  skyBlue: '#4A90D9',
  skyBlueLight: '#A9D4F5',
  white: '#FFFFFF',
  offWhite: '#F5F7FA',
  navySoft: 'rgba(20, 49, 92, 0.08)',
  greenSoft: 'rgba(76, 175, 80, 0.12)',
  goldSoft: 'rgba(245, 166, 35, 0.14)',
  skySoft: 'rgba(74, 144, 217, 0.12)',
  border: '#D8E4F0',
  muted: '#66758A',
} as const;

/** GasTa! design tokens — navy, green, gold, and sky visual system. */
export const GasTaColors = {
  cream: BrandColors.offWhite,
  creamLight: BrandColors.white,
  creamDark: '#E8F0F8',
  white: BrandColors.white,
  forest: BrandColors.navy,
  forestDark: '#0D2345',
  forestMuted: 'rgba(20, 49, 92, 0.68)',
  forestGlow: BrandColors.skySoft,
  forestBorder: 'rgba(20, 49, 92, 0.20)',
  textPrimary: BrandColors.navy,
  textMuted: BrandColors.muted,
  textSoft: '#95A3B5',
  textOnForest: BrandColors.white,
  glassFill: 'rgba(255, 255, 255, 0.76)',
  glassFillStrong: 'rgba(255, 255, 255, 0.96)',
  glassBorder: 'rgba(255, 255, 255, 0.98)',
  glassBorderSubtle: BrandColors.border,
  glassHighlight: 'rgba(255, 255, 255, 0.85)',
  error: '#D64545',
} as const;

export const GasTaSpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const GasTaRadius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const palette = {
  primary: BrandColors.green,
  primarySoft: BrandColors.greenSoft,
  primaryDark: '#3E8E40',
  success: BrandColors.green,
  successSoft: BrandColors.greenSoft,
  warning: BrandColors.gold,
  warningSoft: BrandColors.goldSoft,
  danger: '#D64545',
  dangerSoft: 'rgba(214, 69, 69, 0.10)',
} as const;

export const spacing = GasTaSpacing;
export const radii = GasTaRadius;

export const typography = {
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 } satisfies TextStyle,
  subtitle: { fontSize: 15, fontWeight: '500', lineHeight: 22 } satisfies TextStyle,
  section: { fontSize: 18, fontWeight: '700' } satisfies TextStyle,
  body: { fontSize: 15, fontWeight: '500' } satisfies TextStyle,
  caption: { fontSize: 12, fontWeight: '500' } satisfies TextStyle,
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 } satisfies TextStyle,
};

export function shadow(scheme: 'light' | 'dark', size: 'sm' | 'md' | 'lg' = 'md'): ViewStyle {
  const elevation = size === 'sm' ? 2 : size === 'lg' ? 10 : 6;
  const radius = size === 'sm' ? 4 : size === 'lg' ? 16 : 8;
  const opacity = scheme === 'dark' ? 0.4 : 0.08;

  return {
    shadowColor: BrandColors.navy,
    shadowOffset: { width: 0, height: size === 'sm' ? 1 : 4 },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  };
}

export type AppTheme = {
  scheme: 'light' | 'dark';
  background: string;
  surface: string;
  border: string;
  borderLight: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  overlay: string;
};

export function getTheme(_scheme: 'light' | 'dark' | null | undefined): AppTheme {
  return {
    scheme: 'light',
    background: BrandColors.offWhite,
    surface: BrandColors.white,
    border: BrandColors.border,
    borderLight: BrandColors.navySoft,
    text: BrandColors.navy,
    textSecondary: BrandColors.muted,
    textMuted: '#8391A3',
    overlay: BrandColors.skySoft,
  };
}
