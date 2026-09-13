import { useState } from 'react';
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';

import { GasTaColors, GasTaRadius } from '@/constants/Theme';

type AuthTextFieldProps = TextInputProps & {
  label: string;
  fontSize?: number;
};

export default function AuthTextField({
  label,
  fontSize = 16,
  style,
  onFocus,
  onBlur,
  ...props
}: AuthTextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrapper, focused && styles.wrapperFocused]}>
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={GasTaColors.textSoft}
        style={[styles.input, { fontSize }, style]}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    borderRadius: GasTaRadius.sm,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: 'rgba(248, 240, 229, 0.7)',
    overflow: 'hidden',
  },
  wrapperFocused: {
    borderColor: GasTaColors.forestBorder,
    backgroundColor: 'rgba(1, 68, 33, 0.06)',
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 2,
  },
  input: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 15,
    color: GasTaColors.textPrimary,
  },
});
