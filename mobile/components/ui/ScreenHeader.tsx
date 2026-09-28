import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, spacing, typeScale } from '@/constants/Theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional right-hand action, e.g. a restrained text+icon link. */
  action?: ReactNode;
}

/**
 * Canonical header for TAB ROOT screens (Phase 1).
 *
 * Replaces the full-bleed white slab of `PageHero`:
 *   title 22/800 navy
 *   subtitle 13 muted
 *   optional right action
 *
 * Deliberately NOT applied to any screen yet — the two screens still using
 * `PageHero` (Prices, Profile) are scheduled for a later migration phase, and
 * swapping their header now would be a partial redesign.
 *
 * No `module` prop and no accent bar: `moduleColors` maps every module to the
 * same colour, so the prop was decorative only.
 *
 * Safe-area note: this expects the page to already be inset (the tab layout
 * wraps screens in a top `SafeAreaView`). It adds no top padding of its own.
 */
export default function ScreenHeader({ title, subtitle, action }: ScreenHeaderProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
      {subtitle ? (
        <Text numberOfLines={2} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  titleBlock: { flex: 1 },
  title: {
    ...typeScale.pageTitle,
    color: colors.navy,
  },
  action: {
    flexShrink: 0,
    minHeight: 32,
    justifyContent: 'center',
  },
  subtitle: {
    ...typeScale.caption,
    color: colors.muted,
    marginTop: 3,
  },
});
