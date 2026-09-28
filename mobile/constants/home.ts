import { colors } from '@/constants/Theme';

/**
 * Backward-compatible alias for the canonical in-app palette.
 *
 * Originally this file *defined* the navy/green tokens for the Home screen. It
 * now re-exports the same values from `constants/Theme`, which is the single
 * source of truth (Phase 1). Every value is byte-identical to what it was, so
 * the four existing consumers — home, budget, vehicles, trip, and
 * shared-vehicle-history — are visually unchanged by this refactor.
 *
 * New code should prefer `colors` from `@/constants/Theme` directly. This
 * alias stays for compatibility and can be deleted once those screens migrate.
 */
export const HomeColors = {
  primary: colors.primary,
  primaryDark: colors.primaryDark,
  primarySoft: colors.primarySoft,
  primaryBorder: colors.primaryBorder,
  onPrimary: colors.onPrimary,
  /** Navy for headings and primary copy — matches the wordmark in homeheader.png. */
  navy: colors.navy,
  navySoft: colors.navySoft,
  /** Muted blue-gray for secondary copy. */
  muted: colors.muted,
  /** Very light cool-gray page background. */
  background: colors.background,
  /** Very light gray border for cards on the light background. */
  border: colors.border,
  /** Canonical surface fill. */
  white: colors.surface,
} as const;
