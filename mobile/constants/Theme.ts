import type { TextStyle, ViewStyle } from 'react-native';

/** GasTa! design tokens — Cream + Forest Green palette. */
export const GasTaColors = {
  cream: '#F8F0E5',
  creamLight: '#FDFAF6',
  creamDark: '#EDE3D6',
  white: '#FFFFFF',
  forest: '#014421',
  forestDark: '#013019',
  forestMuted: 'rgba(1, 68, 33, 0.68)',
  forestGlow: 'rgba(1, 68, 33, 0.12)',
  forestBorder: 'rgba(1, 68, 33, 0.32)',
  textPrimary: '#014421',
  textMuted: 'rgba(1, 68, 33, 0.62)',
  textSoft: 'rgba(1, 68, 33, 0.42)',
  textOnForest: '#F8F0E5',
  glassFill: 'rgba(255, 255, 255, 0.62)',
  glassFillStrong: 'rgba(255, 255, 255, 0.9)',
  glassBorder: 'rgba(255, 255, 255, 0.95)',
  glassBorderSubtle: 'rgba(1, 68, 33, 0.1)',
  glassHighlight: 'rgba(255, 255, 255, 0.65)',
  error: '#DC2626',
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
  primary: '#014421',
  primarySoft: 'rgba(1, 68, 33, 0.08)',
  primaryDark: '#013019',
  success: '#014421',
  successSoft: 'rgba(1, 68, 33, 0.08)',
  warning: '#B45309',
  warningSoft: 'rgba(255, 255, 255, 0.92)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220, 38, 38, 0.1)',
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
    shadowColor: GasTaColors.forest,
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
    background: 'transparent',
    surface: GasTaColors.glassFillStrong,
    border: GasTaColors.glassBorderSubtle,
    borderLight: 'rgba(1, 68, 33, 0.08)',
    text: GasTaColors.textPrimary,
    textSecondary: GasTaColors.textMuted,
    textMuted: GasTaColors.textSoft,
    overlay: 'rgba(1, 68, 33, 0.06)',
  };
}
