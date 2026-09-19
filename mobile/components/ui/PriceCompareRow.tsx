import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import ProgressBar from '@/components/ui/ProgressBar';
import { palette, radii, spacing, typography } from '@/constants/Theme';
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
  const initials = company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const difference = price - minPrice;

  return (
    <View
      style={[
        styles.row,
        !isLast && {
          borderBottomColor: theme.borderLight,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        isLowest && {
          backgroundColor: theme.scheme === 'dark' ? '#064E3B33' : palette.successSoft,
          borderRadius: radii.md,
          marginHorizontal: -spacing.xs,
          paddingHorizontal: spacing.sm,
        },
      ]}
    >
      <View style={styles.identity}>
        <View
          style={[
            styles.logoPlaceholder,
            { backgroundColor: isLowest ? palette.success : theme.overlay },
          ]}
        >
          <Text style={[styles.logoText, { color: isLowest ? '#F8F0E5' : theme.text }]}>
            {initials || rank}
          </Text>
        </View>
        <Text style={[styles.rank, { color: theme.textMuted }]}>#{rank}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={styles.companyBlock}>
            <Text style={[styles.company, { color: theme.text }]}>{company}</Text>
            <Text style={[styles.badge, { color: isLowest ? palette.success : theme.textMuted }]}>
              {isLowest
                ? 'Lowest DOE price'
                : difference > 0
                  ? `+${formatCurrency(difference)} vs lowest`
                  : 'DOE company price'}
            </Text>
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
  identity: {
    width: 44,
    alignItems: 'center',
    gap: 2,
  },
  logoPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 12, fontWeight: '800' },
  rank: {
    fontSize: 10,
    fontWeight: '700',
  },
  body: { flex: 1, gap: spacing.sm },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
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
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
