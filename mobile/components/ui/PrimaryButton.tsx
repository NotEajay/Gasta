import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing } from '@/constants/theme';
import { useTheme } from '@/lib/useTheme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'secondary';
  style?: ViewStyle;
  size?: 'md' | 'sm';
}

export default function PrimaryButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
  style,
  size = 'md',
}: PrimaryButtonProps) {
  const theme = useTheme();

  const backgroundColor =
    variant === 'danger'
      ? palette.danger
      : variant === 'secondary'
        ? 'transparent'
        : palette.primary;

  const textColor =
    variant === 'secondary' ? palette.primary : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        {
          backgroundColor,
          borderColor: variant === 'secondary' ? palette.primary : backgroundColor,
          opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
        },
        variant === 'secondary' && { backgroundColor: theme.surface },
        style,
      ]}>
      <Text style={[styles.label, size === 'sm' && styles.labelSm, { color: textColor }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  buttonSm: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  labelSm: {
    fontSize: 14,
  },
});
