import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { getFuelTypePresentation } from '@/constants/fuelTypePresentation';
import { getFuelTypeColor } from '@/constants/fuelTypeColors';
import { designSystem as D, radii, spacing } from '@/constants/Theme';
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
  compact?: boolean;
};

export default function FuelTypeFilter({ label, value, onChange, context, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const selectedOther = MORE_FUELS.find((fuel) => fuel.code === value);
  const otherPresentation = getFuelTypePresentation(selectedOther?.code);
  const otherTone = getFuelTypeColor(selectedOther?.code);
  const supported = DOE_FUEL_TYPES.some((fuel) => fuel.code === value);
  const ControlsContainer = compact ? ScrollView : View;

  useFocusEffect(useCallback(() => () => setOpen(false), []));

  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      <View style={styles.labelRow}><Text style={styles.label}>{label}</Text>{context}</View>
      <ControlsContainer
        {...(compact ? { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.compactControls } : {})}
        style={compact ? styles.compactScroll : styles.controls}>
        <View style={compact ? [styles.commonChoices, styles.compactCommonChoices] : styles.commonChoices} accessibilityRole="radiogroup" accessibilityLabel={label}>
          {COMMON_FUELS.map((fuel) => {
          const selected = fuel.code === value;
          const presentation = getFuelTypePresentation(fuel.code);
          const tone = getFuelTypeColor(fuel.code);
          return (
            <Pressable
              key={fuel.code}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${fuel.name}`}
              accessibilityHint={presentation.primaryLabel}
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              onPress={() => onChange(fuel.code)}
              style={({ pressed }) => [styles.choice, compact && styles.compactChoice,
                { backgroundColor: tone.soft, borderColor: tone.border },
                selected && { ...styles.selected, backgroundColor: tone.soft, borderColor: tone.strong },
                pressed && styles.pressed]}>
              {selected ? <MaterialCommunityIcons name="check" size={12} color={tone.text} />
                : <View style={[styles.fuelDot, { backgroundColor: presentation.accent }]} />}
              <View style={styles.choiceCopy}>
                <Text style={[styles.choiceText, { color: tone.text }]}>{compact && presentation.subtitle ? presentation.primaryLabel.replace(' Unleaded', '') : presentation.primaryLabel}</Text>
                {presentation.subtitle ? <Text style={[styles.choiceSubtitle, { color: tone.text }]}>{presentation.subtitle}</Text> : null}
              </View>
            </Pressable>
          );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selectedOther ? `${label}: ${selectedOther.name}. Open more fuel types` : 'More fuel types'}
          accessibilityHint={selectedOther ? otherPresentation.primaryLabel : undefined}
          accessibilityState={{ selected: Boolean(selectedOther), expanded: open }}
          aria-pressed={Boolean(selectedOther)}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.moreChoice, compact && styles.compactMoreChoice,
            selectedOther && { ...styles.selected, backgroundColor: otherTone.soft, borderColor: otherTone.strong },
            pressed && styles.pressed]}>
          <View style={[styles.fuelDot, { backgroundColor: selectedOther ? otherTone.text : otherPresentation.accent }]} />
          <Text style={[styles.choiceText, selectedOther && { color: otherTone.text }]}>
            {selectedOther ? <>{compact && otherPresentation.subtitle ? otherPresentation.primaryLabel.replace(' Unleaded', '') : otherPresentation.primaryLabel}{otherPresentation.subtitle ? <Text style={styles.choiceSubtitle}>{`\n${otherPresentation.subtitle}`}</Text> : null}</> : compact ? 'More' : 'More fuels'}
          </Text>
          {selectedOther ? <MaterialCommunityIcons name="check" size={12} color={otherTone.text} accessible={false} /> : null}
          <MaterialCommunityIcons name="chevron-down" size={16}
            color={selectedOther ? otherTone.text : D.color.action} />
        </Pressable>
      </ControlsContainer>
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
              <View accessibilityRole="radiogroup" accessibilityLabel="More fuel types">
                <FlatList
                  data={MORE_FUELS}
                keyExtractor={(fuel) => fuel.code}
                style={styles.list}
                renderItem={({ item }) => {
                  const selected = item.code === value;
                  const presentation = getFuelTypePresentation(item.code);
                  return (
                    <Pressable accessibilityRole="radio" accessibilityLabel={`${label}: ${item.name}`} accessibilityHint={presentation.primaryLabel}
                      accessibilityState={{ selected, checked: selected }}
                      aria-checked={selected}
                      onPress={() => { onChange(item.code); setOpen(false); }}
                      style={({ pressed }) => [styles.option,
                        selected && { backgroundColor: presentation.softBackground, borderColor: presentation.accent },
                        pressed && styles.pressed]}>
                      <View style={[styles.fuelDot, { backgroundColor: presentation.accent }]} />
                      <View style={styles.optionCopy}>
                        <Text style={styles.optionText}>{presentation.primaryLabel}</Text>
                        {presentation.subtitle ? <Text style={styles.optionSubtitle}>{presentation.subtitle}</Text> : null}
                      </View>
                      {selected ? <MaterialCommunityIcons name="check" size={20} color={presentation.accent} /> : null}
                    </Pressable>
                  );
                  }}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 6 },
  compactContainer: { marginTop: 0 },
  compactScroll: { flexGrow: 0 },
  compactControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactCommonChoices: { flexWrap: 'nowrap', flexShrink: 0 },
  compactChoice: { minWidth: 70, paddingHorizontal: 6, paddingVertical: 3 },
  compactMoreChoice: { minWidth: 62, paddingHorizontal: 6, paddingVertical: 3, flexShrink: 0 },
  choiceCopy: { alignItems: 'center', maxWidth: 100 },
  choiceSubtitle: { fontSize: 10, lineHeight: 12, fontWeight: '400' },
  optionCopy: { flex: 1 },
  optionSubtitle: { fontSize: 12, lineHeight: 17, color: D.color.textSecondary },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  label: {
    color: D.color.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '500',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  commonChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '100%' },
  choice: {
    minWidth: 76, minHeight: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderRadius: 999,
    borderColor: D.color.borderSubtle, backgroundColor: D.color.surface,
  },
  moreChoice: {
    minWidth: 108, minHeight: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderRadius: 999,
    borderColor: D.color.borderSubtle, backgroundColor: D.color.surface,
  },
  choiceText: { flexShrink: 1, fontSize: 11, lineHeight: 14, fontWeight: '600', color: D.color.textPrimary },
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
  optionText: { fontSize: 15, color: D.color.textPrimary },
});
