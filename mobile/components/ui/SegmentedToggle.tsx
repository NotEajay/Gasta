import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';

interface SegmentedToggleProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  module?: string;
}

export default function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: SegmentedToggleProps<T>) {
  return (
    <View style={styles.wrap}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.item, selected && styles.itemActive]}>
            <Text style={[styles.label, selected && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: GasTaColors.creamDark,
    borderRadius: radii.md,
    padding: 4,
    gap: 4,
    marginBottom: spacing.md,
  },
  item: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActive: {
    backgroundColor: GasTaColors.white,
  },
  label: {
    color: GasTaColors.textSoft,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelActive: {
    color: GasTaColors.forestDark,
    fontWeight: '700',
  },
});
