import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import type { ModuleKey } from '@/constants/moduleColors';
import { GasTaColors, palette, radii, spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface ChipOption<T extends string> {
  value: T;
  label: string;
  subtitle?: string | null;
}

interface ChipSelectProps<T extends string> {
  label: string;
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  hideLabel?: boolean;
  module?: ModuleKey;
}

export default function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  hideLabel,
  module = 'prices',
}: ChipSelectProps<T>) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      {!hideLabel ? (
        <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label}${option.subtitle ? `, ${option.subtitle}` : ''}`}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: selected ? palette.primary : theme.border,
                  backgroundColor: selected ? palette.primarySoft : theme.surface,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <Text
                style={[
                  styles.chipText,
                  {
                    color: selected ? palette.primary : theme.text,
                    fontWeight: selected ? '700' : '500',
                  },
                ]}>
                {option.label}
              </Text>
              {option.subtitle ? <Text style={[styles.chipSubtitle, { color: theme.textSecondary }]}>{option.subtitle}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
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
  scroll: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
  },
  chipSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 2 },
});
