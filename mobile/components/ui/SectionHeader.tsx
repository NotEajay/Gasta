import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { moduleColors, type ModuleKey } from '@/constants/moduleColors';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/lib/useTheme';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  module?: ModuleKey;
}

export default function SectionHeader({ title, subtitle, action, module = 'prices' }: SectionHeaderProps) {
  const theme = useTheme();
  const accent = moduleColors[module].main;

  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        <View style={[styles.accentBar, { backgroundColor: accent }]} />
        <View style={styles.textBlock}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  accentBar: {
    width: 4,
    borderRadius: 2,
    marginTop: 3,
    alignSelf: 'stretch',
    minHeight: 28,
  },
  textBlock: { flex: 1 },
  title: {
    ...typography.section,
    fontSize: 18,
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
});
