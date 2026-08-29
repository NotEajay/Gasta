import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

type MetricTone = 'neutral' | 'success' | 'warning' | 'danger' | 'primary';

interface MetricTileProps {
  label: string;
  value: string;
  tone?: MetricTone;
  style?: ViewStyle;
}

const TONE = {
  neutral: {
    bg: { light: '#FFFFFF', dark: '#FFFFFF' },
    border: { light: 'rgba(1, 68, 33, 0.1)', dark: 'rgba(1, 68, 33, 0.1)' },
    value: { light: '#014421', dark: '#014421' },
    label: { light: 'rgba(1, 68, 33, 0.62)', dark: 'rgba(1, 68, 33, 0.62)' },
  },
  primary: {
    bg: { light: palette.primarySoft, dark: palette.primarySoft },
    border: { light: 'rgba(1, 68, 33, 0.32)', dark: 'rgba(1, 68, 33, 0.32)' },
    value: { light: palette.primaryDark, dark: palette.primaryDark },
    label: { light: palette.primary, dark: palette.primary },
  },
  success: {
    bg: { light: palette.successSoft, dark: palette.successSoft },
    border: { light: 'rgba(1, 68, 33, 0.2)', dark: 'rgba(1, 68, 33, 0.2)' },
    value: { light: palette.success, dark: palette.success },
    label: { light: palette.success, dark: palette.success },
  },
  warning: {
    bg: { light: palette.warningSoft, dark: palette.warningSoft },
    border: { light: 'rgba(180, 83, 9, 0.28)', dark: 'rgba(180, 83, 9, 0.28)' },
    value: { light: palette.warning, dark: palette.warning },
    label: { light: '#B45309', dark: '#B45309' },
  },
  danger: {
    bg: { light: palette.dangerSoft, dark: palette.dangerSoft },
    border: { light: '#FECACA', dark: '#FECACA' },
    value: { light: palette.danger, dark: palette.danger },
    label: { light: '#B91C1C', dark: '#B91C1C' },
  },
} as const;

export default function MetricTile({ label, value, tone = 'neutral', style }: MetricTileProps) {
  const theme = useTheme();
  const colors = TONE[tone];

  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: colors.bg[theme.scheme],
          borderColor: colors.border[theme.scheme],
        },
        style,
      ]}>
      <Text style={[styles.label, { color: colors.label[theme.scheme] }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.value[theme.scheme] }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1.5,
    padding: spacing.md,
    minWidth: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  value: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});
