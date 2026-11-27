import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { GasTaColors, colors, radii, spacing } from '@/constants/Theme';

type LandingLinkVariant = 'primary' | 'secondary' | 'quiet';

interface LandingLinkProps {
  children: ReactNode;
  href: string;
  variant?: LandingLinkVariant;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export default function LandingLink({
  children,
  href,
  variant = 'primary',
  style,
  accessibilityLabel,
}: LandingLinkProps) {
  const variantStyle = variant === 'primary'
    ? styles.primary
    : variant === 'secondary'
      ? styles.secondary
      : styles.quiet;

  return (
    <Link
      accessibilityLabel={accessibilityLabel}
      href={href as Href}
      style={[styles.base, variantStyle, style] as never}>
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.primaryLabel : styles.lightLabel,
        ]}>
        {children}
      </Text>
    </Link>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    display: 'flex',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    textDecorationLine: 'none',
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondary: {
    backgroundColor: GasTaColors.white,
    borderColor: colors.primaryBorder,
  },
  quiet: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  primaryLabel: {
    color: GasTaColors.white,
  },
  lightLabel: {
    color: colors.navy,
  },
});
