import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/ui/ProgressBar';
import { palette, radii, spacing, typography } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';
import { useTheme } from '@/lib/useTheme';
import type { ModeEvaluation } from '@/types/mcda';

interface ModeRankCardProps {
  rank: number;
  evaluation: ModeEvaluation;
  label: string;
  recommended?: boolean;
  maxScore: number;
}

export default function ModeRankCard({
  rank,
  evaluation,
  label,
  recommended,
  maxScore,
}: ModeRankCardProps) {
  const theme = useTheme();
  const scoreRatio = maxScore > 0 ? evaluation.weightedScore / maxScore : 0;

  return (
    <Card
      elevated={recommended}
      style={
        recommended
          ? {
              borderColor: 'rgba(1, 68, 33, 0.32)',
            }
          : undefined
      }>
      <View style={styles.header}>
        <View
          style={[
            styles.rankCircle,
            {
              backgroundColor: recommended ? palette.success : theme.overlay,
            },
          ]}>
          <Text style={[styles.rankText, { color: recommended ? '#F8F0E5' : theme.text }]}>
            {rank}
          </Text>
        </View>
        <View style={styles.headerBody}>
          <Text style={[styles.mode, { color: theme.text }]}>{label}</Text>
          {recommended ? (
            <Text style={styles.recommendedBadge}>Recommended</Text>
          ) : null}
        </View>
        <View style={styles.scoreBlock}>
          <Text style={[styles.scoreLabel, { color: theme.textSecondary }]}>Score</Text>
          <Text style={[styles.score, { color: theme.text }]}>
            {evaluation.weightedScore.toFixed(3)}
          </Text>
        </View>
      </View>
      <ProgressBar
        progress={scoreRatio}
        color={recommended ? palette.success : palette.primary}
        trackColor={theme.borderLight}
      />
      <View style={styles.metrics}>
        <View style={[styles.metricPill, { backgroundColor: theme.overlay }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Fuel</Text>
          <Text style={[styles.metricValue, { color: theme.text }]}>
            {formatCurrency(evaluation.raw.fuelCost)}
          </Text>
        </View>
        <View style={[styles.metricPill, { backgroundColor: theme.overlay }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Time</Text>
          <Text style={[styles.metricValue, { color: theme.text }]}>
            {evaluation.raw.travelTime.toFixed(0)} min
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  rankCircle: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontWeight: '800', fontSize: 14 },
  headerBody: { flex: 1 },
  mode: { ...typography.body, fontWeight: '700', fontSize: 16 },
  recommendedBadge: {
    color: palette.success,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  scoreBlock: { alignItems: 'flex-end' },
  scoreLabel: { ...typography.caption },
  score: { fontWeight: '800', fontSize: 16 },
  metrics: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  metricPill: {
    flex: 1,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
  },
  metricLabel: { ...typography.caption, marginBottom: 2 },
  metricValue: { fontWeight: '700', fontSize: 14 },
});
