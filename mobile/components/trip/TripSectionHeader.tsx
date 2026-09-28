import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { HomeColors } from '@/constants/home';
import { spacing } from '@/constants/Theme';

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
    <View style={styles.wrap}>
      <Text style={styles.title}>Trip Optimizer</Text>
      <Text style={styles.subtitle}>
        Compare route, travel time, and fuel costs.
      </Text>

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
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: HomeColors.navy,
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: HomeColors.muted,
    marginBottom: spacing.md,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HomeColors.border,
  },
  tab: {
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  tabActive: {
    borderBottomColor: HomeColors.primary,
  },
  tabPressed: {
    opacity: 0.75,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: HomeColors.muted,
  },
  tabLabelActive: {
    color: HomeColors.primary,
    fontWeight: '700',
  },
});
