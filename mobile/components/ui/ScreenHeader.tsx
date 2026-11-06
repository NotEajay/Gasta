import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { colors, spacing, typeScale } from '@/constants/Theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
}

export default function ScreenHeader({ title, subtitle, eyebrow, action }: ScreenHeaderProps) {
  return (
    <View style={styles.wrap}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg, paddingTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  eyebrow: {
    ...typeScale.label, color: colors.primary, textTransform: 'uppercase',
    letterSpacing: 1.8, marginBottom: spacing.sm,
  },
  title: { ...typeScale.pageTitle, color: colors.navy, letterSpacing: -0.9 },
  subtitle: { ...typeScale.bodySmall, color: colors.muted, lineHeight: 21, marginTop: 6 },
  action: { flexShrink: 0, justifyContent: 'center', minHeight: 44 },
});
