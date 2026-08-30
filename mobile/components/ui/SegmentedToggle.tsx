import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, radii, spacing } from '@/constants/Theme';

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
    backgroundColor: 'rgba(1, 68, 33, 0.06)',
    borderRadius: radii.sm,
    padding: 5,
    gap: 6,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    marginBottom: spacing.md,
  },
  item: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  itemActive: {
    backgroundColor: GasTaColors.forest,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  },
  label: {
    color: GasTaColors.textSoft,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelActive: {
    color: GasTaColors.textOnForest,
    fontWeight: '800',
  },
});
