import type { TextStyle, ViewStyle } from 'react-native';

/** Quiet Confidence foundation. Existing exports below are frozen compatibility
 * tokens: opt components in with appearance="standard" during screen migration. */
const color = {
  structure: '#142235', action: '#2563EB', actionPressed: '#1D4ED8', actionSoft: '#EBF2FF',
  brand: '#2E7D32', canvas: '#F8F7F4', surface: '#FFFFFF', surfaceElevated: '#FFFFFF',
  textPrimary: '#172B4D', textSecondary: '#526176', textTertiary: '#637083', onDark: '#FFFDF8',
  borderSubtle: '#E1E5EB', borderControl: '#7F8DA0', success: '#166534', warning: '#92400E',
  error: '#B42318', errorPressed: '#912018', info: '#1D4ED8', neutral: '#526176',
  warmAccent: '#8A611B', scrim: 'rgba(20,34,53,0.42)',
  successSoft: '#EAF5EE', warningSoft: '#FFF4DE', errorSoft: '#FDEDEB', neutralSoft: '#EEF1F4',
  disabledSurface: '#E9EDF2',
} as const;

export const designSystem = {
  color,
  type: {
    metricHero: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.4 },
    pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.3 },
    pageTitleCompact: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 },
    sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
    cardTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
    body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    bodyDense: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
    supporting: { fontSize: 13, lineHeight: 20, fontWeight: '400' },
    metadata: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
    control: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
    fieldLabel: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
    eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.3 },
  } satisfies Record<string, TextStyle>,
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 },
  radius: { small: 8, control: 12, card: 16, featured: 20, overlay: 24 },
  elevation: {
    0: { shadowOpacity: 0, elevation: 0 },
    1: { shadowColor: color.structure, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, shadowOpacity: 0.05, elevation: 2 },
    2: { shadowColor: color.structure, shadowOffset: { width: 0, height: 8 }, shadowRadius: 20, shadowOpacity: 0.10, elevation: 6 },
  } satisfies Record<number, ViewStyle>,
  control: { mobileHeight: 48, desktopHeight: 44, minTarget: 44, fieldHeight: 48, icon: 20 },
  motion: { interaction: 150, content: 180, overlay: 220, maxTranslate: 8 },
  focusRing: { outlineColor: color.action, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 } as ViewStyle,
  status: {
    success: { foreground: color.success, background: color.successSoft, icon: 'checkmark-circle-outline' },
    warning: { foreground: color.warning, background: color.warningSoft, icon: 'alert-circle-outline' },
    error: { foreground: color.error, background: color.errorSoft, icon: 'close-circle-outline' },
    info: { foreground: color.info, background: color.actionSoft, icon: 'information-circle-outline' },
    neutral: { foreground: color.neutral, background: color.neutralSoft, icon: 'ellipse-outline' },
  },
} as const;

export type DesignAppearance = 'legacy' | 'standard';
export type StatusTone = keyof typeof designSystem.status;

/** Compatibility palette for unmigrated screens, HomeColors and navigation.
 * Values intentionally stay stable; new standard components use designSystem. */
export const colors = {
  // Brand
  /** Primary green: actions, active states, money-positive values. */
  primary: '#2E7D32',
  /** Pressed / text-on-green. */
  primaryDark: '#1B5E20',
  /** Tinted green fill for selected chips and soft emphasis. */
  primarySoft: 'rgba(46, 125, 50, 0.10)',
  /** Hairline green for selected outlines. */
  primaryBorder: 'rgba(46, 125, 50, 0.24)',
  /** Text/icon colour placed on top of `primary`. */
  onPrimary: '#FFFFFF',

  /** Navy: headings, and all authoritative data values. */
  navy: '#0E2A52',
  /** Very light navy wash for quiet panels. */
  navySoft: 'rgba(14, 42, 82, 0.06)',

  /** Muted blue-gray: every secondary line of copy. */
  muted: '#5A6B84',

  // Surfaces
  /** Cool neutral page canvas. */
  background: '#F5F7FA',
  /** Card / panel fill. */
  surface: '#FFFFFF',
  /** Universal hairline border. */
  border: 'rgba(14, 42, 82, 0.10)',

  // Status
  success: '#2E7D32',
  successSoft: 'rgba(46, 125, 50, 0.10)',
  warning: '#B45309',
  warningSoft: 'rgba(180, 83, 9, 0.10)',
  warningBorder: 'rgba(180, 83, 9, 0.24)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220, 38, 38, 0.10)',
  dangerBorder: 'rgba(220, 38, 38, 0.24)',
} as const;

export type GasTaColorsType = typeof colors;

/** Status colour lookup used by InlineNotice and status chips. */
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

/** GasTa! design tokens — Cream + Forest Green palette (legacy/branding). */
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

/**
 * Feature brand accents used by the trip pick-map screen (PR #9).
 * Only the keys that screen actually reads are defined here; pick-map imports
 * this object from constants/Theme.
 */
export const BrandColors = {
  skyBlue: '#0EA5E9',
  border: GasTaColors.glassBorderSubtle,
} as const;

/** Compatibility type scale. New standard components use designSystem.type;
 * retain these values until their screen consumers migrate explicitly. */
export const typeScale = {
  /** The one authoritative number on a screen. Reserve for results. */
  display: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 } satisfies TextStyle,
  /** Page title. */
  pageTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 } satisfies TextStyle,
  /** Section heading. */
  sectionHeading: { fontSize: 17, fontWeight: '700' } satisfies TextStyle,
  /** Title inside a card or list row. */
  cardTitle: { fontSize: 16, fontWeight: '700' } satisfies TextStyle,
  /** Default reading size. */
  body: { fontSize: 15, fontWeight: '500' } satisfies TextStyle,
  /** Slightly condensed reading size for dense lists. */
  bodySmall: { fontSize: 14, fontWeight: '500' } satisfies TextStyle,
  /** Secondary/meta copy. */
  caption: { fontSize: 13, fontWeight: '500' } satisfies TextStyle,
  /** True eyebrow/label only — pair with textTransform: 'uppercase'. */
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 } satisfies TextStyle,
} as const;

/** Existing icon sizes, retained for compatibility. */
export const iconSize = {
  /** Inline, next to a word. */
  inline: 16,
  /** Row-leading and action icons. */
  row: 20,
  /** Section-level. */
  section: 24,
  /** Hero / result. */
  hero: 28,
} as const;

export const spacing = GasTaSpacing;
export const radii = GasTaRadius;

/**
 * Legacy typography scale. Superseded by `typeScale` above; retained because
 * `PageHero`, `SubPageHeader`, `SectionHeader`, `ModeRankCard` and others still
 * spread these values. Migrate consumers, then delete this object.
 */
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
