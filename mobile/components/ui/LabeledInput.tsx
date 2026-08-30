import { StyleSheet, TextInput as RNTextInput, View, type TextInputProps } from 'react-native';

import { Text } from '@/components/Themed';
import { radii, spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface LabeledInputProps extends TextInputProps {
  label: string;
}

export default function LabeledInput({ label, style, ...props }: LabeledInputProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <RNTextInput
        {...props}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: '#FFFFFF',
          },
          style,
        ]}
        placeholderTextColor={theme.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
});
