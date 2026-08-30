import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/Themed';
import { moduleColors, type ModuleKey } from '@/constants/moduleColors';
import { radii, spacing, shadow, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface StatCardProps {
  label: string;
  value: string;
  meta?: string;
  variant?: 'default' | 'primary' | 'success';
  module?: ModuleKey;
  style?: ViewStyle;
}

export default function StatCard({
  label,
  value,
  meta,
  variant = 'primary',
  module = 'prices',
  style,
}: StatCardProps) {
  const theme = useTheme();
  const mod = moduleColors[module];
  const isPrimary = variant === 'primary' || variant === 'success';

  return (
    <View
      style={[
        styles.card,
        isPrimary
          ? {
              backgroundColor: theme.scheme === 'dark' ? mod.gradientTop : mod.soft,
              borderColor: theme.scheme === 'dark' ? mod.main : mod.main + '33',
            }
          : {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
        shadow(theme.scheme, 'md'),
        style,
      ]}>
      <View style={[styles.iconBadge, { backgroundColor: mod.main }]}>
        <Text style={[styles.iconText, { color: '#F8F0E5' }]}>₱</Text>
      </View>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: isPrimary ? mod.dark : theme.text }]}>{value}</Text>
      {meta ? (
        <View style={[styles.metaPill, { backgroundColor: mod.main + '18' }]}>
          <Text style={[styles.meta, { color: mod.main }]}>{meta}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1.5,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  iconText: {
    color: '#F8F0E5',
    fontSize: 18,
    fontWeight: '800',
  },
  label: {
    ...typography.label,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  value: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
  },
  metaPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
  meta: {
    fontSize: 14,
    fontWeight: '700',
  },
});
