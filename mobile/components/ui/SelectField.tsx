import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Themed';
import { designSystem as D, GasTaColors, palette, radii, spacing, typography, type DesignAppearance } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import IconButton from '@/components/ui/IconButton';

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
  /**
   * Optional inline validation message. Its presence switches the selector to its
   * error state (danger border, faint danger tint) and renders the reason
   * directly underneath, so it is readable text rather than a colour cue alone.
   */
  error?: string;
  helperText?: string;
  disabled?: boolean;
  loading?: boolean;
  readOnly?: boolean;
  appearance?: DesignAppearance;
};

export default function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  error,
  helperText,
  disabled = false,
  loading = false,
  readOnly = false,
  appearance = 'legacy',
}: SelectFieldProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusedOption, setFocusedOption] = useState<string | null>(null);
  const sheetRef = useRef<View>(null);
  const id = useId();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const standard = appearance === 'standard';
  const blocked = disabled || loading || readOnly;
  useEffect(() => {
    if (!standard || !open || Platform.OS !== 'web') return;
    const sheet = sheetRef.current as unknown as HTMLElement | null;
    if (!sheet?.addEventListener) return;
    const navigate = (event: KeyboardEvent) => {
      const choices = Array.from(sheet.querySelectorAll<HTMLElement>('[role="radio"]'));
      const index = choices.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length;
      choices[next]?.focus();
    };
    sheet.addEventListener('keydown', navigate);
    return () => sheet.removeEventListener('keydown', navigate);
  }, [open, standard]);
  const invalid = Boolean(error);
  const selected = useMemo(
    () => options.find((option) => option.value === value)?.label ?? placeholder,
    [options, placeholder, value]
  );

  return (
    <View style={styles.wrap}>
      <Text nativeID={`${id}-label`} style={standard ? styles.standardLabel : [styles.label, { color: invalid ? palette.danger : theme.textSecondary }]}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}${readOnly ? ', read only' : ''}`}
        accessibilityState={{ disabled: blocked, busy: loading, expanded: open }}
        aria-describedby={error || helperText ? `${id}-description` : undefined}
        aria-invalid={invalid}
        disabled={blocked}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onPress={() => { if (!blocked) setOpen(true); }}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            opacity: pressed ? 0.9 : 1,
          },
          invalid && { borderColor: palette.danger, backgroundColor: palette.dangerSoft },
          standard && styles.standardField,
          standard && { borderColor: invalid ? D.color.error : focused ? D.color.action : D.color.borderControl,
            backgroundColor: disabled ? D.color.disabledSurface : pressed ? D.color.actionSoft : D.color.surface },
          standard && Platform.OS === 'web' && focused && D.focusRing,
        ]}>
        <Text style={standard ? styles.standardValue : [styles.value, { color: theme.text }]} numberOfLines={standard ? undefined : 1}>
          {selected}
        </Text>
        {loading ? <ActivityIndicator size="small" color={standard ? D.color.action : theme.textSecondary} accessible={false} />
          : !readOnly ? <Text style={[styles.chevron, { color: standard ? D.color.textSecondary : theme.textSecondary }]} accessible={false}>▾</Text> : null}
      </Pressable>
      {error || helperText ? <Text nativeID={`${id}-description`} accessibilityRole={error ? 'alert' : undefined}
        accessibilityLiveRegion={error ? 'assertive' : 'polite'} style={standard ? [styles.standardHelper, { color: error ? D.color.error : D.color.textSecondary }] : styles.errorText}>{error || helperText}</Text> : null}

      <Modal visible={open} transparent animationType={standard && reducedMotion ? 'none' : 'fade'} accessibilityLabel={label} onRequestClose={() => setOpen(false)}>
        <Pressable accessible={false} focusable={false} style={[styles.backdrop, standard && { backgroundColor: D.color.scrim }, standard && width >= 768 && styles.desktopBackdrop]} onPress={() => setOpen(false)}>
          <Pressable
            ref={sheetRef} accessible={false} focusable={false}
            style={[styles.sheet, { backgroundColor: GasTaColors.creamLight }, standard && styles.standardSheet,
              standard && { paddingBottom: Math.max(insets.bottom, D.space[6]) }, standard && width >= 768 && styles.desktopSheet]}
            onPress={(e) => e.stopPropagation()}>
            <View style={standard && styles.sheetHeader}>
              <Text accessibilityRole="header" style={standard ? styles.standardTitle : [styles.sheetTitle, { color: theme.text }]}>{label}</Text>
              {standard ? <IconButton icon="close" accessibilityLabel={`Close ${label} options`} onPress={() => setOpen(false)} /> : null}
            </View>
            <FlatList
              accessibilityRole="radiogroup"
              accessibilityLabel={label}
              data={[...options]}
              keyExtractor={(item) => item.value}
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ selected: isSelected }}
                    onFocus={() => setFocusedOption(item.value)} onBlur={() => setFocusedOption(null)}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected && { backgroundColor: GasTaColors.forestGlow },
                      pressed && { opacity: 0.85 },
                      standard && { minHeight: D.control.fieldHeight, borderRadius: D.radius.small, backgroundColor: isSelected ? D.color.actionSoft : D.color.surface },
                      standard && Platform.OS === 'web' && focusedOption === item.value && D.focusRing,
                    ]}>
                    <Text
                      style={[
                        styles.optionText,
                        { color: theme.text, fontWeight: isSelected ? '800' : '500' },
                        standard && { ...D.type.body, color: D.color.textPrimary, fontWeight: isSelected ? '600' : '400' },
                      ]}>
                      {item.label}
                    </Text>
                    {isSelected ? (
                      <Text style={{ color: standard ? D.color.action : palette.success, fontWeight: '800' }} accessible={false}>✓</Text>
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
  standardLabel: { ...D.type.fieldLabel, color: D.color.textSecondary, marginBottom: D.space[2] },
  standardField: { minHeight: D.control.fieldHeight, borderRadius: D.radius.control },
  standardValue: { ...D.type.body, color: D.color.textPrimary, flex: 1 },
  standardHelper: { ...D.type.supporting, marginTop: D.space[2] },
  standardSheet: { backgroundColor: D.color.surfaceElevated, borderTopLeftRadius: D.radius.overlay, borderTopRightRadius: D.radius.overlay, borderWidth: 0 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: D.space[2], paddingHorizontal: D.space[4], marginBottom: D.space[2] },
  standardTitle: { ...D.type.sectionTitle, flex: 1, color: D.color.textPrimary },
  desktopBackdrop: { justifyContent: 'center', alignItems: 'center', padding: D.space[6] },
  desktopSheet: { width: '100%', maxWidth: 560, borderRadius: D.radius.overlay, ...D.elevation[2] },
  wrap: { marginBottom: spacing.md },
  errorText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    color: palette.danger,
  },
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
    backgroundColor: 'rgba(20, 49, 92, 0.38)',
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
