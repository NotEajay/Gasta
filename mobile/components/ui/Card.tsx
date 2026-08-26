import { StyleSheet, View, type ViewProps } from 'react-native';

import { radii, shadow, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/useTheme';

interface CardProps extends ViewProps {
  elevated?: boolean;
  compact?: boolean;
}

export default function Card({ style, elevated, compact, ...props }: CardProps) {
  const theme = useTheme();

  return (
    <View
      {...props}
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
        elevated && shadow(theme.scheme, 'md'),
        compact && styles.compact,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  compact: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
