import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { moduleColors, type ModuleKey } from '@/constants/moduleColors';
import { radii, spacing, typography } from '@/constants/theme';

interface SubPageHeaderProps {
  module: ModuleKey;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export default function SubPageHeader({ module, title, subtitle, children }: SubPageHeaderProps) {
  const router = useRouter();
  const colors = moduleColors[module];

  return (
    <View style={[styles.wrap, { backgroundColor: colors.gradientTop }]}>
      <View style={[styles.glow, { backgroundColor: colors.gradientBottom }]} />
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
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    top: -30,
    right: -20,
    opacity: 0.4,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    ...typography.title,
    color: '#FFFFFF',
    fontSize: 24,
  },
  subtitle: {
    ...typography.subtitle,
    color: 'rgba(255,255,255,0.88)',
    marginTop: spacing.xs,
  },
});
