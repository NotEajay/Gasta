import type { ViewProps } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import Card from '@/components/ui/Card';
import { moduleColors, type ModuleKey } from '@/constants/moduleColors';
import { spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface FormSectionProps extends ViewProps {
  title: string;
  subtitle?: string;
  module?: ModuleKey;
}

export default function FormSection({
  title,
  subtitle,
  module = 'prices',
  children,
  style,
  ...props
}: FormSectionProps) {
  const theme = useTheme();
  const accent = moduleColors[module].main;

  return (
    <View style={[styles.wrap, style]} {...props}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      <Card elevated style={styles.card}>
        {children}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  headerText: { flex: 1 },
  title: {
    ...typography.section,
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  card: {
    marginBottom: 0,
    paddingTop: spacing.sm,
  },
});
