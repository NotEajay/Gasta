import { StyleSheet, TextInput as RNTextInput, View, type TextInputProps } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface LabeledInputProps extends TextInputProps {
  label: string;
  /**
   * Optional inline validation message.
   *
   * Its presence switches the field into its error state: the label and the
   * border go danger, a faint danger tint sits behind the text, and the message
   * renders directly underneath. The reason is therefore readable text rather
   * than a colour cue alone.
   *
   * Optional and additive, so existing call sites are unaffected.
   */
  error?: string;
}

export default function LabeledInput({ label, error, style, ...props }: LabeledInputProps) {
  const theme = useTheme();
  const invalid = Boolean(error);

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: invalid ? palette.danger : theme.textSecondary }]}>
        {label}
      </Text>
      <RNTextInput
        {...props}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.surface,
          },
          // Danger wins over the theme border/tint, but still yields to an
          // explicit `style` override from the caller.
          invalid && { borderColor: palette.danger, backgroundColor: palette.dangerSoft },
          style,
        ]}
        placeholderTextColor={theme.textMuted}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
  errorText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    color: palette.danger,
  },
});
