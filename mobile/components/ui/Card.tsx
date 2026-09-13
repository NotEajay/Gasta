import { StyleSheet, type ViewProps } from 'react-native';

import GlassSurface from '@/components/ui/GlassSurface';
import { radii, spacing } from '@/constants/Theme';

interface CardProps extends ViewProps {
  elevated?: boolean;
  compact?: boolean;
}

export default function Card({ style, elevated, compact, ...props }: CardProps) {
  return (
    <GlassSurface
      variant={elevated ? 'strong' : 'default'}
      style={[styles.card, compact && styles.compact, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  compact: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
