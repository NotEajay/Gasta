import type { ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, iconSize, radii, spacing, statusColors, typeScale } from '@/constants/Theme';

export type InlineNoticeVariant = 'info' | 'success' | 'warning' | 'error';

interface InlineNoticeProps {
  variant?: InlineNoticeVariant;
  /** Short headline. Optional — a body-only notice is fine. */
  title?: string;
  children?: ReactNode;
  /** Plain-text alternative to `children`. */
  message?: string;
  /** Optional trailing action, e.g. "Retry" or "Go to Vehicles". */
  action?: ReactNode;
}

const VARIANT_ICON: Record<InlineNoticeVariant, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  warning: 'alert-circle-outline',
  error: 'close-circle-outline',
};

/**
 * Canonical inline feedback surface (Phase 1).
 *
 * This is the replacement the 36 `Alert.alert` call sites should migrate to:
 * a tinted, bordered, flat block that sits in the layout instead of a modal.
 *
 *   - field validation  -> `error`, placed directly under the input
 *   - status/warnings   -> `warning`
 *   - success           -> `success` (a future toast can use the same tokens)
 *   - neutral context   -> `info`
 *
 * Per the card rule, this is a notice, not a card: no shadow, no blur, no
 * gradient, and a hairline border rather than a heavy container.
 *
 * No screen is migrated to this yet — that is Phase 2+ work.
 */
export default function InlineNotice({
  variant = 'info',
  title,
  children,
  message,
  action,
}: InlineNoticeProps) {
  const tone = statusColors[variant];

  return (
    <View
      accessibilityRole="alert"
      style={[styles.wrap, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <Ionicons name={VARIANT_ICON[variant]} size={iconSize.row} color={tone.fg} />
      <View style={styles.body}>
        {title ? <Text style={[styles.title, { color: tone.fg }]}>{title}</Text> : null}
        {message ? (
          <Text style={[styles.message, { color: colors.navy }]}>{message}</Text>
        ) : null}
        {children}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  body: { flex: 1 },
  title: {
    ...typeScale.cardTitle,
    marginBottom: 2,
  },
  message: {
    ...typeScale.caption,
    lineHeight: 19,
  },
  action: {
    flexShrink: 0,
    justifyContent: 'center',
  },
});