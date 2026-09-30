import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
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
    /*
     * Compact dark header plus a floating capsule, as siblings.
     *
     * Previously the segmented control sat INSIDE the dark panel, so the two
     * read as one oversized green banner and the header looked like a hero
     * block. Splitting them lets the dark ground end at the subtitle, with the
     * tabs sitting just below its lower edge and overlapping slightly.
     */
    <>
      <View style={styles.wrap}>
        <View style={styles.motif} />
        <Text style={styles.title}>Trip Cost Optimizer</Text>
        <Text style={styles.subtitle}>Compare every way to get there.</Text>
      </View>

      {/* Floating navigation capsule: warm white on cream, so it is clearly
          separate from the dark header it hangs off. */}
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
  /*
   * The dark ground bleeds edge to edge and ends at the subtitle. The negative
   * margin is exactly cancelled by the matching padding, so content is net
   * inset by the page gutter and no cream sliver can appear at either edge at
   * any width. The bleed is what makes this read as a header rather than a
   * card, so it is kept -- but it no longer has to carry the tabs too.
   */
  wrap: {
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    paddingTop: spacing.md,
    // Only enough to clear the title block: the tabs are not inside this view
    // any more, so there is no reason to reserve green space beneath them.
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    backgroundColor: GasTaColors.forest,
    overflow: 'hidden',
  },
  /* Barely-there hairline arc: felt, not read. */
  motif: {
    position: 'absolute',
    top: 12,
    right: 18,
    width: 104,
    height: 46,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderTopRightRadius: 60,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  title: {
    ...typeScale.pageTitle,
    color: GasTaColors.textOnForest,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    // Brighter than the previous 0.72 so the supporting line stays legible
    // against the forest without competing with the title.
    color: 'rgba(255, 255, 255, 0.80)',
  },
  /*
   * The capsule hangs just below the header's lower edge. The negative top
   * margin creates the overlap; the positive bottom margin restores the rhythm
   * so the tabs do not eat vertical space in the content below.
   */
  tabFloat: {
    alignItems: 'center',
    marginTop: -14,
    marginBottom: spacing.md,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: 999,
    // Warm white capsule, not a dark track: it must read as floating
    // navigation sitting on the cream page, not as part of the banner.
    backgroundColor: GasTaColors.creamLight,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
  },
  tabActive: {
    backgroundColor: GasTaColors.forest,
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
    color: GasTaColors.textOnForest,
    fontWeight: '800',
  },
});
