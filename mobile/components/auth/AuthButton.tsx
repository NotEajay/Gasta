import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { GasTaColors, GasTaRadius } from '@/constants/Theme';

type AuthButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  fontSize?: number;
};

export default function AuthButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fontSize = 16,
}: AuthButtonProps) {
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        isPrimary && styles.primary,
        isSecondary && styles.secondary,
        variant === 'ghost' && styles.ghost,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={isPrimary ? GasTaColors.textOnForest : GasTaColors.forest} />
      ) : (
        <Text
          style={[
            styles.label,
            { fontSize },
            isPrimary && styles.primaryLabel,
            isSecondary && styles.secondaryLabel,
            variant === 'ghost' && styles.ghostLabel,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    borderRadius: GasTaRadius.sm,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primary: {
    backgroundColor: GasTaColors.forest,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  secondary: {
    backgroundColor: 'rgba(248, 240, 229, 0.55)',
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  primaryLabel: {
    color: GasTaColors.textOnForest,
  },
  secondaryLabel: {
    color: GasTaColors.textPrimary,
  },
  ghostLabel: {
    color: GasTaColors.forestDark,
    fontWeight: '600',
  },
});
