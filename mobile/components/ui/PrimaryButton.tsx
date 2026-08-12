import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'secondary';
  style?: ViewStyle;
}

export default function PrimaryButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
  style,
}: PrimaryButtonProps) {
  const scheme = useColorScheme();
  const tint = Colors[scheme].tint;

  const backgroundColor =
    variant === 'danger' ? '#c0392b' : variant === 'secondary' ? 'transparent' : tint;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor: tint,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        variant === 'secondary' && styles.secondary,
        style,
      ]}>
      <Text
        style={[
          styles.label,
          variant === 'secondary' && { color: tint },
          variant !== 'secondary' && { color: '#fff' },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondary: {
    borderWidth: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});
