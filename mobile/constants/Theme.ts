import type { TextStyle, ViewStyle } from 'react-native';

/** GasTa visual system: ink navy, muted cobalt and a restrained citron accent.
 * Legacy export names remain aliases so existing screens share the same palette.
 */
export const colors = {
  // Brand
  primary: '#3E5FB5',
  primaryDark: '#304D96',
  primarySoft: '#EFF2F8',
  primaryBorder: '#D5DDEB',
  onPrimary: '#FFFFFF',

  navy: '#192D42',
  navySoft: '#EDF1F4',

  muted: '#617083',

  accent: '#DCE9B5',
  onAccent: '#192D42',

  // Surfaces
  background: '#F5F6F7',
  surface: '#FFFFFF',
  border: '#E2E6EB',

  // Status
  success: '#147D57',
  successSoft: '#E9F6EF',
  warning: '#B45309',
  warningSoft: 'rgba(180, 83, 9, 0.10)',
  warningBorder: 'rgba(180, 83, 9, 0.24)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220, 38, 38, 0.10)',
  dangerBorder: 'rgba(220, 38, 38, 0.24)',
} as const;

export type GasTaColorsType = typeof colors;

export const statusColors = {
  info: { fg: colors.navy, bg: colors.navySoft, border: colors.border },
  success: {
    fg: colors.success,
    bg: colors.successSoft,
    border: colors.primaryBorder,
  },
  warning: {
    fg: colors.warning,
    bg: colors.warningSoft,
    border: colors.warningBorder,
  },
  error: { fg: colors.danger, bg: colors.dangerSoft, border: colors.dangerBorder },
} as const;

export const GasTaColors = {
  accent: colors.accent,
  cream: colors.background,
  creamLight: '#FFFFFF',
  creamDark: '#E9EDF1',
  white: '#FFFFFF',
  forest: colors.primary,
  forestDark: colors.navy,
  forestMuted: colors.muted,
  forestGlow: colors.primarySoft,
  forestBorder: colors.primaryBorder,
  textPrimary: colors.navy,
  textMuted: '#566679',
  textSoft: '#687789',
  textOnForest: '#FFFFFF',
  glassFill: '#FFFFFF',
  glassFillStrong: '#FFFFFF',
  glassBorder: colors.border,
  glassBorderSubtle: colors.border,
  glassHighlight: '#FFFFFF',
  error: colors.danger,
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
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const palette = {
  primary: colors.primary,
  primarySoft: colors.primarySoft,
  primaryDark: colors.navy,
  success: '#147D57',
  successSoft: '#E9F6EF',
  warning: '#B45309',
  warningSoft: 'rgba(255, 255, 255, 0.92)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220, 38, 38, 0.1)',
} as const;

export const BrandColors = {
  skyBlue: '#0EA5E9',
  border: GasTaColors.glassBorderSubtle,
} as const;

export const typeScale = {
  display: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 } satisfies TextStyle,
  pageTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4 } satisfies TextStyle,
  sectionHeading: { fontSize: 17, fontWeight: '700' } satisfies TextStyle,
  cardTitle: { fontSize: 16, fontWeight: '700' } satisfies TextStyle,
  body: { fontSize: 15, fontWeight: '500' } satisfies TextStyle,
  bodySmall: { fontSize: 14, fontWeight: '500' } satisfies TextStyle,
  caption: { fontSize: 13, fontWeight: '500' } satisfies TextStyle,
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 } satisfies TextStyle,
} as const;

export const iconSize = {
  inline: 16,
  row: 20,
  section: 24,
  hero: 28,
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
  const elevation = size === 'sm' ? 1 : size === 'lg' ? 4 : 2;
  const radius = size === 'sm' ? 4 : size === 'lg' ? 16 : 8;
  const opacity = scheme === 'dark' ? 0.4 : 0.045;

  return {
    shadowColor: colors.navy,
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
    background: colors.background,
    surface: GasTaColors.glassFillStrong,
    border: GasTaColors.glassBorderSubtle,
    borderLight: '#EFF2F8',
    text: GasTaColors.textPrimary,
    textSecondary: GasTaColors.textMuted,
    textMuted: GasTaColors.textSoft,
    overlay: '#EDF1F4',
  };
}
