import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { getFuelTypePresentation } from '@/constants/fuelTypePresentation';
import { designSystem as D, radii, spacing } from '@/constants/Theme';
import { useResponsive } from '@/hooks/useResponsive';
import { useReducedMotion } from '@/hooks/useReducedMotion';

// Presentation only. Keep canonical labels and the existing order for More.
const COMMON_CODES: readonly DoeFuelTypeCode[] = ['RON_91', 'RON_95', 'DIESEL'];
const COMMON_FUELS = COMMON_CODES.map((code) => DOE_FUEL_TYPES.find((fuel) => fuel.code === code)!);
const MORE_FUELS = DOE_FUEL_TYPES.filter((fuel) => !COMMON_CODES.includes(fuel.code));

type Props = {
  label: string;
  context?: ReactNode;
  value: DoeFuelTypeCode;
  onChange: (code: DoeFuelTypeCode) => void;
};

export default function FuelTypeFilter({ label, value, onChange, context }: Props) {
  const [open, setOpen] = useState(false);
  const { width } = useResponsive();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const selectedOther = MORE_FUELS.find((fuel) => fuel.code === value);
  const otherPresentation = getFuelTypePresentation(selectedOther?.code);
  const supported = DOE_FUEL_TYPES.some((fuel) => fuel.code === value);
  // Give an active More label room for its accent border and dropdown arrow.
  const twoColumns = width < 480 && Boolean(selectedOther);

  useFocusEffect(useCallback(() => () => setOpen(false), []));

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}><Text style={styles.label}>{label}</Text>{context}</View>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {COMMON_FUELS.map((fuel) => {
          const selected = fuel.code === value;
          const presentation = getFuelTypePresentation(fuel.code);
          return (
            <Pressable
              key={fuel.code}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${fuel.name}`}
              accessibilityState={{ selected }}
              onPress={() => onChange(fuel.code)}
              style={({ pressed }) => [styles.choice, twoColumns && styles.twoColumns,
                selected && { ...styles.selected, backgroundColor: presentation.softBackground, borderColor: presentation.accent },
                pressed && styles.pressed]}>
              {selected ? <MaterialCommunityIcons name="check" size={12} color={presentation.accent} />
                : <View style={[styles.fuelDot, { backgroundColor: presentation.accent }]} />}
              <Text style={[styles.choiceText, selected && styles.selectedText]}>{fuel.name}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selectedOther ? `${label}: ${selectedOther.name}. More fuel types` : 'More fuel types'}
          accessibilityState={{ selected: Boolean(selectedOther), expanded: open }}
          aria-pressed={Boolean(selectedOther)}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.choice, twoColumns && styles.twoColumns,
            selectedOther && { ...styles.selected, backgroundColor: otherPresentation.softBackground, borderColor: otherPresentation.accent },
            pressed && styles.pressed]}>
          <Text style={[styles.choiceText, selectedOther && styles.selectedText]}>
            {selectedOther?.name ?? 'More'}
          </Text>
          {selectedOther ? <MaterialCommunityIcons name="check" size={12} color={otherPresentation.accent} accessible={false} /> : null}
          <MaterialCommunityIcons name="chevron-down" size={16}
            color={selectedOther ? otherPresentation.accent : D.color.action} />
        </Pressable>
      </View>
      {!supported ? <Text style={styles.unavailable}>Selected fuel type is unavailable.</Text> : null}

      {open ? (
        <Modal transparent animationType={reduced ? 'none' : 'fade'} visible onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} accessibilityLabel="Close more fuel types" onPress={() => setOpen(false)}>
            <Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()}
              style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
              <View style={styles.sheetHeader}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>More fuel types</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close fuel options"
                  style={styles.close} onPress={() => setOpen(false)}>
                  <MaterialCommunityIcons name="close" size={20} color={D.color.textPrimary} />
                </Pressable>
              </View>
              <FlatList
                data={MORE_FUELS}
                keyExtractor={(fuel) => fuel.code}
                style={styles.list}
                renderItem={({ item }) => {
                  const selected = item.code === value;
                  const presentation = getFuelTypePresentation(item.code);
                  return (
                    <Pressable accessibilityRole="radio" accessibilityLabel={`${label}: ${item.name}`}
                      accessibilityState={{ selected }}
                      onPress={() => { onChange(item.code); setOpen(false); }}
                      style={({ pressed }) => [styles.option,
                        selected && { backgroundColor: presentation.softBackground, borderColor: presentation.accent },
                        pressed && styles.pressed]}>
                      <View style={[styles.fuelDot, { backgroundColor: presentation.accent }]} />
                      <Text style={styles.optionText}>{item.name}</Text>
                      {selected ? <MaterialCommunityIcons name="check" size={20} color={presentation.accent} /> : null}
                    </Pressable>
                  );
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  label: {
    color: D.color.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '500',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: {
    flexBasis: '22%', flexGrow: 1, flexShrink: 0, minWidth: 44, minHeight: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    paddingHorizontal: 3, paddingVertical: 4,
    borderWidth: 1, borderRadius: 10,
    borderColor: D.color.borderSubtle, backgroundColor: D.color.surface,
  },
  twoColumns: { flexBasis: '46%' },
  choiceText: { flexShrink: 1, fontSize: 13, fontWeight: '600', textAlign: 'center', color: D.color.textPrimary },
  selected: { borderWidth: 2 },
  selectedText: { color: D.color.textPrimary, fontWeight: '600' },
  fuelDot: { width: 6, height: 6, borderRadius: 3 },
  pressed: { opacity: 0.85 },
  unavailable: { color: D.color.textTertiary, fontSize: 12, marginTop: spacing.xs },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: D.color.scrim },
  sheet: { maxHeight: '72%', backgroundColor: D.color.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.lg, paddingRight: spacing.sm },
  sheetTitle: { color: D.color.textPrimary, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: spacing.md },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: 'transparent' },
  optionText: { flex: 1, fontSize: 15, color: D.color.textPrimary },
});
