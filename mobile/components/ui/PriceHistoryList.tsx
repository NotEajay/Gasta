import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing, typography } from '@/constants/Theme';
import { formatCurrency, formatShortDate } from '@/lib/format';
import { useTheme } from '@/lib/useTheme';

export interface HistoryPoint {
  bulletin_date: string;
  price_per_liter: number;
}

interface PriceHistoryListProps {
  points: HistoryPoint[];
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}

export default function PriceHistoryList({
  points,
  selectedDate,
  onSelectDate,
}: PriceHistoryListProps) {
  const theme = useTheme();

  if (points.length === 0) return null;

  const todayIso = (() => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
  })();

  // Ignore future-dated rows so a bad seed like 2026-12-30 cannot become "This week".
  const newestFirst = [...points]
    .filter((point) => point.bulletin_date <= todayIso)
    .sort((a, b) => b.bulletin_date.localeCompare(a.bulletin_date));

  if (newestFirst.length === 0) return null;

  return (
    <View>
      {newestFirst.map((point, index) => {
        const older = newestFirst[index + 1];
        const delta = older ? point.price_per_liter - older.price_per_liter : null;
        const selected = selectedDate === point.bulletin_date;
        const isLatest = index === 0;

        return (
          <Pressable
            key={point.bulletin_date}
            disabled={!onSelectDate}
            onPress={() => onSelectDate?.(point.bulletin_date)}
            style={[
              styles.row,
              {
                borderBottomColor: theme.borderLight,
                backgroundColor: selected ? palette.primarySoft : 'transparent',
              },
              index === newestFirst.length - 1 && styles.last,
            ]}>
            <View style={styles.left}>
              <Text style={[styles.date, { color: theme.text }]}>
                {formatShortDate(point.bulletin_date)}
                {isLatest ? '  ·  Latest' : ''}
              </Text>
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {isLatest ? 'Latest Tuesday week' : 'Past Tuesday week'}
              </Text>
            </View>
            <View style={styles.right}>
              <Text style={[styles.price, { color: theme.text }]}>
                {formatCurrency(point.price_per_liter)}
              </Text>
              {delta === null ? (
                <Text style={[styles.delta, { color: theme.textMuted }]}>—</Text>
              ) : (
                <Text
                  style={[
                    styles.delta,
                    {
                      color:
                        delta > 0 ? palette.danger : delta < 0 ? palette.success : theme.textMuted,
                    },
                  ]}>
                  {delta > 0 ? '▲' : delta < 0 ? '▼' : '→'} {formatCurrency(Math.abs(delta))}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
  },
  last: { borderBottomWidth: 0 },
  left: { flex: 1 },
  date: { ...typography.body, fontWeight: '700' },
  hint: { ...typography.caption, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  price: { fontSize: 16, fontWeight: '800' },
  delta: { ...typography.caption, fontWeight: '700', marginTop: 2 },
});
