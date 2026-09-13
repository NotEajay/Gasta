import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, radii, spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type SelectFieldProps<T extends string> = {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
};

export default function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
}: SelectFieldProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => options.find((option) => option.value === value)?.label ?? placeholder,
    [options, placeholder, value]
  );

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            opacity: pressed ? 0.9 : 1,
          },
        ]}>
        <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
          {selected}
        </Text>
        <Text style={[styles.chevron, { color: theme.textSecondary }]}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: GasTaColors.creamLight }]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>{label}</Text>
            <FlatList
              data={[...options]}
              keyExtractor={(item) => item.value}
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected && { backgroundColor: GasTaColors.forestGlow },
                      pressed && { opacity: 0.85 },
                    ]}>
                    <Text
                      style={[
                        styles.optionText,
                        { color: theme.text, fontWeight: isSelected ? '800' : '500' },
                      ]}>
                      {item.label}
                    </Text>
                    {isSelected ? (
                      <Text style={{ color: GasTaColors.forest, fontWeight: '800' }}>✓</Text>
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: {
    ...typography.label,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  field: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  value: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 16,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 68, 33, 0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  sheetTitle: {
    ...typography.section,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.md,
  },
  option: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionText: {
    fontSize: 15,
    flex: 1,
    paddingRight: spacing.sm,
  },
});
