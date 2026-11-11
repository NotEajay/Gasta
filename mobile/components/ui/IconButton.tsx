import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, useWindowDimensions, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { designSystem as D } from '@/constants/Theme';

interface Props extends Omit<PressableProps, 'style' | 'children' | 'accessibilityLabel'> {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  loading?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function IconButton({ icon, accessibilityLabel, loading = false, destructive = false, disabled, style, onFocus, onBlur, onHoverIn, onHoverOut, accessibilityState, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { width } = useWindowDimensions();
  const blocked = disabled || loading;
  const color = blocked ? D.color.textSecondary : destructive ? D.color.error : D.color.textPrimary;
  return <Pressable {...props} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ ...accessibilityState, disabled: Boolean(blocked), busy: loading }} disabled={blocked}
    onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
    onHoverIn={event => { setHovered(true); onHoverIn?.(event); }} onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
    style={({ pressed }) => [styles.button, { minHeight: Platform.OS === 'web' && width >= 1024 ? D.control.minTarget : D.control.mobileHeight,
      minWidth: Platform.OS === 'web' && width >= 1024 ? D.control.minTarget : D.control.mobileHeight,
      backgroundColor: blocked ? D.color.disabledSurface : pressed || hovered ? D.color.actionSoft : 'transparent' },
      Platform.OS === 'web' && focused && D.focusRing, style]}>
    {loading ? <ActivityIndicator size="small" color={color} accessible={false} /> : <Ionicons name={icon} size={D.control.icon} color={color} accessible={false} />}
  </Pressable>;
}
const styles = StyleSheet.create({ button: { borderRadius: D.radius.control, padding: D.space[3], alignItems: 'center', justifyContent: 'center' } });
