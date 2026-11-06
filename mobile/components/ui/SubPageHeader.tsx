import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, radii, spacing, typography } from '@/constants/Theme';
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
      <Pressable accessibilityRole="button" accessibilityLabel="Go back"
        onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && { opacity: 0.65 }]}>
        <Ionicons name="arrow-back" size={20} color={colors.navy} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  back: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    minHeight: 44, paddingHorizontal: 12, borderRadius: radii.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md,
  },
  backText: { fontSize: 13, fontWeight: '600', color: colors.navy },
  title: { ...typography.title, color: colors.navy, letterSpacing: -0.8 },
  subtitle: { ...typography.subtitle, color: colors.muted, marginTop: spacing.sm },
});
