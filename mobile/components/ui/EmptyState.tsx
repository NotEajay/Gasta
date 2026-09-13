import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { radii, spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface EmptyStateProps {
  title: string;
  message: string;
}

export default function EmptyState({ title, message }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
      ]}>
      <View style={[styles.icon, { backgroundColor: theme.overlay }]}>
        <Text style={styles.iconText}>∅</Text>
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xxl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 22,
    opacity: 0.5,
  },
  title: {
    ...typography.section,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    textAlign: 'center',
  },
});
