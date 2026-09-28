import type { TextStyle, ViewStyle } from 'react-native';

/**
 * ============================================================================
 * CANONICAL IN-APP PALETTE  (Phase 1 foundation)
 * ============================================================================
 *
 * This is the single source of truth for in-app colour. New work imports
 * `colors` from here — or the `HomeColors` alias in `constants/home.ts`, which
 * is re-exported from these same values.
 *
 * Why it lives in Theme.ts rather than in constants/home.ts: every shared UI
 * component already imports from `constants/Theme`, so putting the canonical
 * tokens there avoids a circular import (home.ts -> Theme.ts) and keeps one
 * import site for both the modern and legacy components.
 *
 * Deliberately NOT changed in this pass: `GasTaColors`, `palette`, `getTheme`
 * and the `typography` object. Those still drive ~23 legacy files (including
 * `pick-map`, which is map-protected). Mutating them would restyle five
 * unfinished screens at once. See the Phase 1 report for the migration list.
 *
 * Cream is intentionally retained on auth/branding screens only
 * (GasTaColors.cream) — see the approved design decision.
 */
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

/**
 * Canonical 8-step type scale (Phase 1).
 *
 * The repo currently uses 17 distinct font sizes. These tokens are additive:
 * existing screens still use the legacy `typography` object below, which is
 * intentionally untouched so no screen shifts. Migrated screens import
 * `typeScale` and the 17 sizes collapse to these eight.
 */
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

/** Canonical icon sizes (Ionicons). No other values should be needed. */
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
