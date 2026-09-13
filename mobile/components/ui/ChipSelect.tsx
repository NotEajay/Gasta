import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { moduleColors, type ModuleKey } from '@/constants/moduleColors';
import { radii, spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface ChipOption<T extends string> {
  value: T;
  label: string;
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
  const accent = moduleColors[module];

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
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: selected ? accent.main : theme.border,
                  backgroundColor: selected ? accent.main : theme.surface,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <Text
                style={[
                  styles.chipText,
                  {
                    color: selected ? '#F8F0E5' : theme.text,
                    fontWeight: selected ? '700' : '500',
                  },
                ]}>
                {option.label}
              </Text>
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
    borderWidth: 1.5,
  },
  chipText: {
    fontSize: 14,
  },
});
