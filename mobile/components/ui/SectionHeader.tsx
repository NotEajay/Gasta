import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { moduleColors, type ModuleKey } from '@/constants/moduleColors';
import { colors, spacing, typeScale, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  module?: ModuleKey;
  /**
   * Phase 1: opt-in canonical treatment — flat, no vertical accent bar, 17/700
   * navy. Defaults to the legacy rendering so the two screens still using this
   * component (Prices, Community) do not shift. Migrate them later.
   */
  variant?: 'legacy' | 'canonical';
}

export default function SectionHeader({
  title,
  subtitle,
  action,
  module = 'prices',
  variant = 'legacy',
}: SectionHeaderProps) {
  const theme = useTheme();

  if (variant === 'canonical') {
    return (
      <View style={styles.canonicalWrap}>
        <View style={styles.canonicalLeft}>
          <Text numberOfLines={2} style={styles.canonicalTitle}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.canonicalSubtitle}>{subtitle}</Text> : null}
        </View>
        {action}
      </View>
    );
  }

  const accent = moduleColors[module].main;

  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        <View style={[styles.accentBar, { backgroundColor: accent }]} />
        <View style={styles.textBlock}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- canonical (Phase 1) ----------------------------------------------
  // Flat label + optional right action. No accent bar, no decorative dot.
  canonicalWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  canonicalLeft: { flex: 1 },
  canonicalTitle: {
    ...typeScale.sectionHeading,
    color: colors.navy,
  },
  canonicalSubtitle: {
    ...typeScale.caption,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 18,
  },

  // ---- legacy (unchanged) ----------------------------------------------
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  accentBar: {
    width: 4,
    borderRadius: 2,
    marginTop: 3,
    alignSelf: 'stretch',
    minHeight: 28,
  },
  textBlock: { flex: 1 },
  title: {
    ...typography.section,
    fontSize: 18,
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
});
