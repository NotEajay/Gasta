import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, iconSize, spacing, typeScale } from '@/constants/Theme';

interface DetailHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional right-hand action. */
  action?: ReactNode;
  /** Set false for a root-level page reached without a push (e.g. a deep link). */
  showBack?: boolean;
}

/**
 * Canonical header for SUBPAGES — screens pushed on top of a tab (Phase 1).
 *
 * Pattern:
 *   [chevron-back]  Title                     [optional action]
 *                  Subtitle
 *
 * Replaces the legacy `SubPageHeader`, still in use by Prices/Community/Report/
 * Saved/History. That component is deliberately untouched in Phase 1 so those
 * screens do not shift; migrate them one at a time, then delete it.
 *
 * Differences from the legacy header: a real Ionicons chevron with a 32pt touch
 * target instead of the literal "← Back" text, a navy title, a muted subtitle,
 * and no full-bleed block, glass, or shadow.
 *
 * NAMING NOTE — read before renaming:
 * This component is called `DetailHeader`, not `SubpageHeader`, on purpose. macOS
 * filesystems are case-insensitive, so `SubpageHeader.tsx` and the existing
 * `SubPageHeader.tsx` are the SAME FILE. Creating the "obvious" name would have
 * silently overwritten the legacy component and broken 4 screens. If you
 * consolidate these two components, do the rename on a case-sensitive
 * filesystem (or via `git mv`) and update all imports in one commit.
 */
export default function DetailHeader({
  title,
  subtitle,
  action,
  showBack = true,
}: DetailHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}>
            <Ionicons name="chevron-back" size={iconSize.section} color={colors.navy} />
          </Pressable>
        ) : null}
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
    alignItems: 'center',
    gap: spacing.xs,
  },
  back: {
    // 32pt visual box, enlarged further by hitSlop.
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  backPressed: { opacity: 0.6 },
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
    // Aligns the subtitle with the title text, not the back chevron.
    marginTop: 2,
    marginLeft: spacing.xs + 4,
  },
});