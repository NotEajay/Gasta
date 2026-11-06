import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import ScreenHeader from '@/components/ui/ScreenHeader';
import { GasTaColors, spacing, typeScale } from '@/constants/Theme';

export type TripSectionTab = 'new' | 'saved' | 'history';

const TABS: { key: TripSectionTab; label: string; href: string }[] = [
  { key: 'new', label: 'New trip', href: '/(tabs)/trip' },
  { key: 'saved', label: 'Saved', href: '/(tabs)/trip/saved' },
  { key: 'history', label: 'History', href: '/(tabs)/trip/history' },
];

interface TripSectionHeaderProps {
  active: TripSectionTab;
}

/**
 * Shared Trip Optimizer chrome: title + underline tabs for New / Saved / History.
 * Presentation only — same routes the old header links already used.
 */
export default function TripSectionHeader({ active }: TripSectionHeaderProps) {
  const router = useRouter();

  return (

    <>
      <ScreenHeader eyebrow="Go your way" title="Plan a trip" subtitle="Compare the cost of getting there." />

      <View style={styles.tabFloat}>
        <View style={styles.tabRow}>
          {TABS.map((tab) => {
            const selected = tab.key === active;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={tab.label}
                onPress={() => {
                  if (selected) return;
                  router.push(tab.href as never);
                }}
                style={({ pressed }) => [
                  styles.tab,
                  selected && styles.tabActive,
                  pressed && styles.tabPressed,
                ]}>
                <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  tabFloat: {
    marginBottom: spacing.lg,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    gap: 4,
    borderRadius: 16,
    backgroundColor: GasTaColors.creamDark,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: GasTaColors.white,
  },
  tabPressed: {
    opacity: 0.75,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    // Muted green on the white capsule.
    color: GasTaColors.forestMuted,
  },
  tabLabelActive: {
    color: GasTaColors.forestDark,
    fontWeight: '700',
  },
});
