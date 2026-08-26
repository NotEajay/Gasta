import type { ReactNode } from 'react';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { moduleColors, type ModuleKey } from '@/constants/moduleColors';
import { radii, spacing, typography } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

interface PageHeroProps {
  module: ModuleKey;
  title: string;
  subtitle?: string;
  /** Quick nav chips below subtitle */
  navItems?: { href: string; label: string }[];
  children?: ReactNode;
}

export default function PageHero({ module, title, subtitle, navItems, children }: PageHeroProps) {
  const colors = moduleColors[module];
  const { user, signOut } = useAuth();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.gradientTop }]}>
      <View style={[styles.glow, { backgroundColor: colors.gradientBottom }]} />
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
        </View>
        {user ? (
          <Pressable onPress={() => signOut()} style={styles.authBtn} hitSlop={8}>
            <Text style={styles.authText}>Sign out</Text>
          </Pressable>
        ) : (
          <Link href="/login" asChild>
            <Pressable style={styles.authBtn} hitSlop={8}>
              <Text style={styles.authText}>Sign in</Text>
            </Pressable>
          </Link>
        )}
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
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    top: -40,
    right: -30,
    opacity: 0.45,
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
    color: '#FFFFFF',
    fontSize: 26,
  },
  subtitle: {
    ...typography.subtitle,
    color: 'rgba(255,255,255,0.88)',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  authBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  authText: {
    color: '#FFFFFF',
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
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  navChipPressed: { opacity: 0.88 },
  navChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
});
