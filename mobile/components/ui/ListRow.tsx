import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface ListRowProps {
  title: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
  isLast?: boolean;
}

export default function ListRow({ title, value, subtitle, highlight, isLast }: ListRowProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomColor: theme.borderLight, borderBottomWidth: StyleSheet.hairlineWidth },
        highlight && { backgroundColor: 'rgba(1, 68, 33, 0.08)' },
      ]}>
      <View style={styles.left}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
        ) : null}
      </View>
      <Text style={[styles.value, { color: highlight ? '#014421' : theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: spacing.sm,
  },
  left: { flex: 1 },
  title: {
    ...typography.body,
    fontWeight: '600',
  },
  subtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  value: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
