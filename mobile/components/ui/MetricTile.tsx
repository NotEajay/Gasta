import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing } from '@/constants/theme';
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
    bg: { light: '#FFFFFF', dark: '#1E293B' },
    border: { light: '#E2E8F0', dark: '#334155' },
    value: { light: '#0F172A', dark: '#F8FAFC' },
    label: { light: '#64748B', dark: '#94A3B8' },
  },
  primary: {
    bg: { light: palette.primarySoft, dark: '#172554' },
    border: { light: '#BFDBFE', dark: '#1E40AF' },
    value: { light: palette.primaryDark, dark: '#93C5FD' },
    label: { light: palette.primary, dark: '#93C5FD' },
  },
  success: {
    bg: { light: palette.successSoft, dark: '#064E3B' },
    border: { light: '#A7F3D0', dark: '#047857' },
    value: { light: palette.success, dark: '#6EE7B7' },
    label: { light: '#047857', dark: '#6EE7B7' },
  },
  warning: {
    bg: { light: palette.warningSoft, dark: '#78350F' },
    border: { light: '#FDE68A', dark: '#B45309' },
    value: { light: palette.warning, dark: '#FCD34D' },
    label: { light: '#B45309', dark: '#FCD34D' },
  },
  danger: {
    bg: { light: palette.dangerSoft, dark: '#7F1D1D' },
    border: { light: '#FECACA', dark: '#B91C1C' },
    value: { light: palette.danger, dark: '#FCA5A5' },
    label: { light: '#B91C1C', dark: '#FCA5A5' },
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
