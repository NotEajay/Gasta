import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import ProgressBar from '@/components/ui/ProgressBar';
import { GasTaColors, palette, radii, spacing, typography } from '@/constants/Theme';
import { formatCurrency } from '@/lib/format';
import { useTheme } from '@/lib/useTheme';

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
  const theme = useTheme();
  const span = maxPrice - minPrice || 1;
  const relative = 1 - (price - minPrice) / span;

  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomColor: theme.borderLight, borderBottomWidth: StyleSheet.hairlineWidth },
        isLowest && {
          backgroundColor: theme.scheme === 'dark' ? '#4CAF5033' : palette.successSoft,
          borderWidth: 1,
          borderColor: 'rgba(76, 175, 80, 0.28)',
          borderRadius: radii.md,
          marginHorizontal: -spacing.xs,
          paddingHorizontal: spacing.sm,
        },
      ]}>
      <View
        style={[
          styles.rankBadge,
          {
            backgroundColor: isLowest ? palette.success : theme.overlay,
          },
        ]}>
        <Text
          style={[
            styles.rank,
            { color: isLowest ? GasTaColors.white : theme.textSecondary },
          ]}>
          {rank}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={styles.companyBlock}>
            <Text style={[styles.company, { color: theme.text }]}>{company}</Text>
            {isLowest ? <Text style={styles.badge}>Best price</Text> : null}
          </View>
          <Text style={[styles.price, { color: isLowest ? palette.success : theme.text }]}>
            {formatCurrency(price)}
            <Text style={styles.unit}>/L</Text>
          </Text>
        </View>
        <ProgressBar
          progress={relative}
          color={isLowest ? palette.success : theme.textMuted}
          height={5}
          trackColor={theme.borderLight}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
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
    backgroundColor: palette.successSoft,
    color: palette.success,
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
