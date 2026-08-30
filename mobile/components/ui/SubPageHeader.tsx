import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, spacing, typography } from '@/constants/Theme';
import type { ModuleKey } from '@/constants/moduleColors';

interface SubPageHeaderProps {
  module: ModuleKey;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export default function SubPageHeader({ title, subtitle, children }: SubPageHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backText: {
    color: GasTaColors.forestDark,
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    ...typography.title,
    color: GasTaColors.textPrimary,
    fontSize: 24,
  },
  subtitle: {
    ...typography.subtitle,
    color: GasTaColors.textMuted,
    marginTop: spacing.xs,
  },
});
