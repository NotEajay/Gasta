import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { designSystem as D, palette, radii } from '@/constants/Theme';
import { formatBulletinRange, formatCurrency } from '@/lib/format';

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
            accessibilityRole="button" accessibilityLabel={formatBulletinRange(point.bulletin_date)}
            accessibilityState={{ selected, disabled: !onSelectDate }}
            onPress={() => onSelectDate?.(point.bulletin_date)}
            style={[
              styles.row,
              {
                borderBottomColor: D.color.borderSubtle,
                backgroundColor: selected ? D.color.actionSoft : 'transparent',
              },
              index === newestFirst.length - 1 && styles.last,
            ]}>
            <View style={styles.left}>
              <Text style={[styles.date, { color: D.color.textPrimary }]}>
                {formatBulletinRange(point.bulletin_date)}
                {isLatest ? '  ·  Latest' : ''}
              </Text>
              <Text style={[styles.hint, { color: D.color.textTertiary }]}>
                {isLatest ? 'Latest DOE bulletin' : 'Past DOE bulletin'}
              </Text>
            </View>
            <View style={styles.right}>
              <Text style={[styles.price, { color: D.color.textPrimary }]}>
                {formatCurrency(point.price_per_liter)}
              </Text>
              {delta === null ? (
                <Text style={[styles.delta, { color: D.color.textTertiary }]}>—</Text>
              ) : (
                <Text
                  style={[
                    styles.delta,
                    {
                      color:
                        delta > 0 ? palette.danger : delta < 0 ? palette.success : D.color.textSecondary,
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
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
  },
  last: { borderBottomWidth: 0 },
  left: { flex: 1 },
  date: { ...D.type.supporting, fontWeight: '500' },
  hint: { ...D.type.metadata, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  price: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  delta: { ...D.type.metadata, fontWeight: '700', marginTop: 2 },
});
