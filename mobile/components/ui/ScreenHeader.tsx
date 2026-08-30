import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  accessory?: ReactNode;
}

export default function ScreenHeader({ title, subtitle, accessory }: ScreenHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      {accessory}
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: spacing.xs,
  },
});
