import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, iconSize, radii, spacing, typeScale, typography, GasTaColors } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface EmptyStateProps {
  title: string;
  message: string;
  /**
   * Phase 1: opt-in canonical treatment (Ionicons outline, no icon bubble,
   * left-aligned, tighter padding). Defaults to the legacy rendering so the two
   * screens still using this component (Prices, Community) do not shift.
   * Migrate them to `variant="canonical"` in a later phase.
   */
  variant?: 'legacy' | 'canonical';
  /** Ionicons name — only used by the canonical variant. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional trailing action, e.g. "Add vehicle". Canonical variant only. */
  action?: ReactNode;
}

export default function EmptyState({
  title,
  message,
  variant = 'legacy',
  icon = 'file-tray-outline',
  action,
}: EmptyStateProps) {
  const theme = useTheme();

  if (variant === 'canonical') {
    return (
      <View style={styles.canonicalWrap}>
        <Ionicons name={icon} size={iconSize.hero} color={colors.muted} />
        <Text style={styles.canonicalTitle}>{title}</Text>
        <Text style={styles.canonicalMessage}>{message}</Text>
        {action ? <View style={styles.canonicalAction}>{action}</View> : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
      ]}>
      <View style={[styles.icon, { backgroundColor: theme.overlay }]}>
        <Text style={styles.iconText}>∅</Text>
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- canonical (Phase 1) ----------------------------------------------
  // No card, no icon bubble: a quiet open block on the page canvas.
  //
  // Colours moved onto the GasTa cream/forest set so this variant is safe on
  // the cream canvas. The legacy variant below is untouched, so Prices and
  // Community (the only current consumers) do not shift.
  canonicalWrap: {
    alignItems: 'flex-start',
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  canonicalTitle: {
    ...typeScale.sectionHeading,
    color: GasTaColors.forestDark,
    marginTop: spacing.xs,
  },
  canonicalMessage: {
    ...typeScale.caption,
    color: GasTaColors.textSoft,
    lineHeight: 19,
  },
  canonicalAction: {
    marginTop: spacing.md,
  },

  // ---- legacy (unchanged) ----------------------------------------------
  wrap: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xxl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 22,
    opacity: 0.5,
  },
  title: {
    ...typography.section,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    textAlign: 'center',
  },
});
