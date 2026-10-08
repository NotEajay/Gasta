import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import ProgressBar from '@/components/ui/ProgressBar';
import { GasTaColors, radii, spacing, typography } from '@/constants/Theme';
import { HomeColors } from '@/constants/home';
import { formatPeso } from '@/lib/format';
import type { ModeEvaluation } from '@/types/mcda';

interface ModeRankCardProps {
  rank: number;
  evaluation: ModeEvaluation;
  label: string;
  recommended?: boolean;
  maxScore: number;
}

/**
 * Row-style ranking card for the Trip Optimizer result list.
 *
 * Presentation only: rank order, `weightedScore`, `raw.fuelCost` and
 * `raw.travelTime` are rendered exactly as MCDA produced them. No score is
 * recalculated and no cost is recomputed here.
 */
export default function ModeRankCard({
  rank,
  evaluation,
  label,
  recommended = false,
  maxScore,
}: ModeRankCardProps) {
  const scoreRatio = maxScore > 0 ? evaluation.weightedScore / maxScore : 0;

  return (
    <View
      style={[
        styles.card,
        recommended && styles.cardRecommended,
      ]}>
      <View style={styles.header}>
        <View style={[styles.rankBadge, recommended && styles.rankBadgeRecommended]}>
          <Text
            style={[
              styles.rankText,
              recommended && { color: GasTaColors.white },
            ]}>
            #{rank}
          </Text>
        </View>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.mode}>
          {label}
        </Text>
        {recommended ? <Text style={styles.recommendedBadge}>Recommended</Text> : null}
      </View>

      <ProgressBar
        progress={scoreRatio}
        color={recommended ? HomeColors.primary : HomeColors.muted}
        trackColor={HomeColors.border}
      />

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Trip cost</Text>
          <Text numberOfLines={1} style={styles.metricValue}>
            {formatPeso(evaluation.raw.fuelCost)}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Travel time</Text>
          <Text numberOfLines={1} style={styles.metricValue}>
            {evaluation.raw.travelTime.toFixed(0)} min
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Score</Text>
          <Text numberOfLines={1} style={styles.metricValue}>
            {evaluation.weightedScore.toFixed(3)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: GasTaColors.white,
    borderWidth: 1,
    borderColor: HomeColors.border,
    marginBottom: spacing.sm,
  },
  cardRecommended: {
    borderColor: HomeColors.primaryBorder,
    borderLeftWidth: 3,
    borderLeftColor: HomeColors.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rankBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.navySoft,
  },
  rankBadgeRecommended: {
    backgroundColor: HomeColors.primary,
  },
  rankText: {
    fontSize: 12,
    fontWeight: '800',
    color: HomeColors.navy,
  },
  mode: {
    flex: 1,
    ...typography.body,
    fontWeight: '700',
    fontSize: 15,
    color: HomeColors.navy,
  },
  recommendedBadge: {
    ...typography.label,
    fontSize: 10,
    color: HomeColors.primary,
    textTransform: 'uppercase',
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  metric: { flex: 1 },
  metricLabel: {
    ...typography.caption,
    fontSize: 11,
    color: HomeColors.muted,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: HomeColors.navy,
  },
});
