import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, radii, spacing, typeScale } from '@/constants/Theme';
import {
  describeAdjustment,
  effectiveTimeLabel,
  fuelNewsDisplayKind,
  fuelNewsKindLabel,
  hasUpdatedCoverage,
  manilaTimestampLabel,
  publisherNames,
  type FuelNewsDisplayKind,
} from '@/lib/fuelNews';
import type { FuelNewsEvent } from '@/lib/services/fuelNews';

const KIND_META: Record<FuelNewsDisplayKind, {
  foreground: string;
  background: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  hike: { foreground: colors.danger, background: colors.dangerSoft, icon: 'trending-up' },
  rollback: { foreground: colors.success, background: colors.successSoft, icon: 'trending-down' },
  mixed: { foreground: colors.warning, background: colors.warningSoft, icon: 'swap-vertical' },
  forecast: { foreground: colors.primaryDark, background: colors.primarySoft, icon: 'time-outline' },
  news_update: { foreground: colors.navy, background: colors.navySoft, icon: 'newspaper-outline' },
};

export function FuelNewsBadge({ event }: { event: FuelNewsEvent }) {
  const kind = fuelNewsDisplayKind(event.classification, event.direction);
  const meta = KIND_META[kind];
  const label = fuelNewsKindLabel(kind);
  return (
    <View
      accessibilityLabel={`Report type: ${label}`}
      style={[styles.badge, { backgroundColor: meta.background }]}>
      <Ionicons name={meta.icon} size={14} color={meta.foreground} />
      <Text style={[styles.badgeText, { color: meta.foreground }]}>{label}</Text>
    </View>
  );
}

export default function FuelNewsCard({
  event,
  onPress,
}: {
  event: FuelNewsEvent;
  onPress: () => void;
}) {
  const lead = event.articles[0];
  const publishers = publisherNames(event.articles);
  const effective = effectiveTimeLabel(event.effectiveAt, event.effectivePrecision);
  const published = manilaTimestampLabel('Published', event.publishedAt);
  const updated = hasUpdatedCoverage(event.articles);
  const sourceCount = event.articles.length;
  const summary = event.summary || lead?.excerpt;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${fuelNewsKindLabel(fuelNewsDisplayKind(event.classification, event.direction))}. ${lead?.headline ?? 'Fuel news report'}`}
      accessibilityHint="Opens the report details"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <FuelNewsBadge event={event} />
        {updated || sourceCount > 1 ? (
          <Text style={styles.updated}>
            {[updated ? 'Updated' : null, sourceCount > 1 ? `${sourceCount} sources` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
      </View>

      <Text style={styles.headline}>{lead?.headline ?? 'Fuel news report'}</Text>
      {summary ? <Text numberOfLines={3} style={styles.excerpt}>{summary}</Text> : null}

      {event.adjustments.length > 0 ? (
        <View style={styles.adjustments}>
          {event.adjustments.map((adjustment) => (
            <View key={adjustment.fuelType} style={styles.adjustmentRow}>
              <Text style={styles.adjustmentFuel}>{describeAdjustment(adjustment).split(':')[0]}</Text>
              <Text style={[
                styles.adjustmentAmount,
                adjustment.amountCentavos > 0
                  ? styles.increase
                  : adjustment.amountCentavos < 0
                    ? styles.decrease
                    : undefined,
              ]}>
                {describeAdjustment(adjustment).split(': ').slice(1).join(': ')}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.unstructured}>No structured fuel adjustment was reported.</Text>
      )}

      {event.hasDiscrepancy ? (
        <View accessibilityRole="alert" style={styles.warning}>
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={styles.warningText}>Source figures differ. Check the originals.</Text>
        </View>
      ) : null}

      <View style={styles.metaBlock}>
        {effective ? <Text style={styles.meta}>{effective}</Text> : null}
        {published ? <Text style={styles.meta}>{published}</Text> : null}
        {event.coverage ? <Text style={styles.meta}>Coverage: {event.coverage}</Text> : null}
        <Text style={styles.attribution}>
          {publishers.length > 1 ? `Sources: ${publishers.join(' · ')}` : `Source: ${publishers[0] ?? 'Publisher'}`}
        </Text>
      </View>

      <View style={styles.readRow}>
        <Text style={styles.readText}>View report</Text>
        <Ionicons name="chevron-forward" size={17} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  pressed: { opacity: 0.82 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  badge: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  badgeText: { ...typeScale.label },
  updated: { ...typeScale.caption, color: colors.primaryDark, flexShrink: 1, textAlign: 'right' },
  headline: { ...typeScale.sectionHeading, color: colors.navy, lineHeight: 24 },
  excerpt: { ...typeScale.bodySmall, color: colors.muted, lineHeight: 21, marginTop: spacing.sm },
  adjustments: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    gap: 6,
  },
  adjustmentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  adjustmentFuel: { ...typeScale.bodySmall, color: colors.navy, fontWeight: '700' },
  adjustmentAmount: { ...typeScale.bodySmall, color: colors.navy, textAlign: 'right' },
  increase: { color: colors.danger },
  decrease: { color: colors.success },
  unstructured: {
    ...typeScale.caption,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: spacing.md,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  warningText: { ...typeScale.caption, color: colors.warning, flex: 1 },
  metaBlock: { marginTop: spacing.md, gap: 3 },
  meta: { ...typeScale.caption, color: colors.muted },
  attribution: { ...typeScale.caption, color: colors.navy, fontWeight: '700', marginTop: 2 },
  readRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: 4 },
  readText: { ...typeScale.bodySmall, color: colors.primary, fontWeight: '700' },
});
