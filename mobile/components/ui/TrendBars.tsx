import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing, typography } from '@/constants/Theme';
import { formatCurrency, formatDate } from '@/lib/format';
import { useTheme } from '@/lib/useTheme';

export interface TrendPoint {
  bulletin_date: string;
  price_per_liter: number;
}

interface TrendBarsProps {
  points: TrendPoint[];
}

export default function TrendBars({ points }: TrendBarsProps) {
  const theme = useTheme();

  if (points.length === 0) return null;

  const min = Math.min(...points.map((p) => p.price_per_liter));
  const max = Math.max(...points.map((p) => p.price_per_liter));
  const span = max - min || 1;
  const latest = points[points.length - 1];

  return (
    <View style={styles.wrap}>
      <View style={[styles.latestRow, { backgroundColor: theme.overlay }]}>
        <View>
          <Text style={[styles.latestLabel, { color: theme.textSecondary }]}>Current week</Text>
          <Text style={[styles.latestDate, { color: theme.textMuted }]}>
            {formatDate(latest.bulletin_date)}
          </Text>
        </View>
        <Text style={[styles.latestPrice, { color: theme.text }]}>
          {formatCurrency(latest.price_per_liter)}/L
        </Text>
      </View>
      {[...points].reverse().map((point, index) => {
        const isLatest = point.bulletin_date === latest.bulletin_date;
        const ratio = 0.2 + ((point.price_per_liter - min) / span) * 0.8;
        const rowLabel = isLatest ? 'Current' : points.length === 2 ? 'Previous' : 'Earlier';

        return (
          <View key={point.bulletin_date} style={styles.row}>
            <View style={styles.dateCol}>
              <Text
                style={[
                  styles.rowLabel,
                  { color: isLatest ? palette.primary : theme.textMuted },
                ]}>
                {rowLabel}
              </Text>
              <Text style={[styles.date, { color: theme.textSecondary }]}>
                {formatDate(point.bulletin_date)}
              </Text>
            </View>
            <View style={[styles.barTrack, { backgroundColor: theme.borderLight }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    flex: ratio,
                    backgroundColor: isLatest ? palette.primary : 'rgba(1, 68, 33, 0.28)',
                  },
                ]}
              />
              <View style={{ flex: 1 - ratio }} />
            </View>
            <Text style={[styles.price, { color: isLatest ? theme.text : theme.textSecondary }]}>
              {formatCurrency(point.price_per_liter)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  latestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  latestLabel: {
    ...typography.label,
  },
  latestDate: {
    ...typography.caption,
    marginTop: 2,
  },
  latestPrice: {
    fontSize: 18,
    fontWeight: '800',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateCol: { width: 88 },
  rowLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 1,
  },
  date: { ...typography.caption },
  barTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 12,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  barFill: { borderRadius: radii.pill },
  price: { width: 68, textAlign: 'right', ...typography.caption, fontWeight: '700' },
});
