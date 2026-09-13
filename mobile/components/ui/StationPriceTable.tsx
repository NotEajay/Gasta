import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, spacing } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';
import { useTheme } from '@/lib/useTheme';

export type StationPriceRow = {
  id: string;
  brand: string;
  station: string;
  price: number | null;
  source: 'community' | 'doe' | 'none';
  status?: string;
};

type Props = {
  rows: StationPriceRow[];
};

const BRAND_DOT: Record<string, string> = {
  seaoil: '#22C55E',
  petron: '#2563EB',
  'flying v': '#EF4444',
  flyingv: '#EF4444',
  ptt: '#A855F7',
  shell: '#F59E0B',
  caltex: '#EA580C',
  phoenix: '#DC2626',
  total: '#0EA5E9',
  unioil: '#64748B',
};

function brandDot(brand: string): string {
  const key = brand.trim().toLowerCase();
  return BRAND_DOT[key] ?? GasTaColors.forest;
}

export default function StationPriceTable({ rows }: Props) {
  const theme = useTheme();

  if (rows.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textSecondary }]}>
        No stations for this filter yet. Report a price at a named station to list it here.
      </Text>
    );
  }

  return (
    <View>
      <View style={[styles.header, { borderBottomColor: theme.borderLight }]}>
        <Text style={[styles.headerCell, styles.brandCol, { color: theme.textSecondary }]}>
          Brand
        </Text>
        <Text style={[styles.headerCell, styles.stationCol, { color: theme.textSecondary }]}>
          Station
        </Text>
        <Text style={[styles.headerCell, styles.priceCol, { color: theme.textSecondary }]}>
          Price
        </Text>
      </View>
      {rows.map((row, index) => (
        <View
          key={row.id}
          style={[
            styles.row,
            index < rows.length - 1 && {
              borderBottomColor: theme.borderLight,
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
          ]}>
          <View style={[styles.brandCol, styles.brandCell]}>
            <View style={[styles.dot, { backgroundColor: brandDot(row.brand) }]} />
            <Text style={[styles.brandText, { color: theme.text }]} numberOfLines={1}>
              {row.brand}
            </Text>
          </View>
          <Text style={[styles.stationText, styles.stationCol, { color: theme.text }]} numberOfLines={2}>
            {row.station}
          </Text>
          <View style={styles.priceCol}>
            <Text style={[styles.priceText, { color: theme.text }]}>
              {row.price != null ? `${formatCurrency(row.price)}/L` : '—'}
            </Text>
            {row.status ? (
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>{row.status}</Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCell: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
  },
  brandCol: { width: '26%' },
  stationCol: { flex: 1, paddingHorizontal: spacing.xs },
  priceCol: { width: '28%', alignItems: 'flex-end' },
  brandCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  brandText: { fontSize: 13, fontWeight: '700', flex: 1 },
  stationText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  priceText: { fontSize: 14, fontWeight: '800' },
  statusText: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  empty: { fontSize: 14, lineHeight: 20 },
});
