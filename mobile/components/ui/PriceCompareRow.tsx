import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import ProgressBar from '@/components/ui/ProgressBar';
import { designSystem as D, radii, spacing, typography } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';

interface PriceCompareRowProps {
  rank: number;
  company: string;
  price: number;
  maxPrice: number;
  minPrice: number;
  isLowest?: boolean;
  isLast?: boolean;
}

export default function PriceCompareRow({
  rank,
  company,
  price,
  maxPrice,
  minPrice,
  isLowest,
  isLast,
}: PriceCompareRowProps) {
  const span = maxPrice - minPrice || 1;
  const relative = 1 - (price - minPrice) / span;

  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomColor: D.color.borderSubtle, borderBottomWidth: StyleSheet.hairlineWidth },
        isLowest && { backgroundColor: D.color.actionSoft },
      ]}>
      <View
        style={[
          styles.rankBadge,
          {
            backgroundColor: isLowest ? D.color.structure : D.color.neutralSoft,
          },
        ]}>
        <Text
          style={[
            styles.rank,
            { color: isLowest ? D.color.onDark : D.color.textSecondary },
          ]}>
          {rank}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={styles.companyBlock}>
            <Text style={[styles.company, { color: D.color.textPrimary }]}>{company}</Text>
            {isLowest ? <Text style={styles.badge}>Best price</Text> : null}
          </View>
          <Text style={[styles.price, { color: D.color.textPrimary }]}>
            {formatCurrency(price)}
            <Text style={styles.unit}>/L</Text>
          </Text>
        </View>
        <ProgressBar
          progress={relative}
          color={D.color.textTertiary}
          height={5}
          trackColor={D.color.borderSubtle}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    alignItems: 'flex-start',
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rank: {
    fontSize: 13,
    fontWeight: '800',
  },
  body: { flex: 1, gap: spacing.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  companyBlock: { flex: 1 },
  company: {
    ...typography.body,
    fontWeight: '700',
  },
  price: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  unit: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.7,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: D.color.actionSoft,
    color: D.color.action,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
    marginTop: 4,
  },
});
