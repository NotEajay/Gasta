import type { ReactNode } from 'react';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, radii, spacing, typography } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';

interface PageHeroProps {
  module?: string;
  title: string;
  subtitle?: string;
  navItems?: { href: string; label: string }[];
  children?: ReactNode;
}

export default function PageHero({ title, subtitle, navItems, children }: PageHeroProps) {
  const { user, signOut } = useAuth();

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
        </View>
        {user ? (
          <Pressable onPress={() => signOut()} style={styles.authBtn} hitSlop={8}>
            <Text style={styles.authText}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {navItems && navItems.length > 0 ? (
        <View style={styles.navRow}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href as never} asChild>
              <Pressable style={({ pressed }) => [styles.navChip, pressed && styles.navChipPressed]}>
                <Text style={styles.navChipText}>{item.label}</Text>
              </Pressable>
            </Link>
          ))}
        </View>
      ) : null}
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  titleBlock: { flex: 1 },
  title: {
    ...typography.title,
    color: GasTaColors.textPrimary,
    fontSize: 26,
  },
  subtitle: {
    ...typography.subtitle,
    color: GasTaColors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  authBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
  },
  authText: {
    color: GasTaColors.forestDark,
    fontSize: 13,
    fontWeight: '700',
  },
  navRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  navChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  navChipPressed: { opacity: 0.88 },
  navChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
});
