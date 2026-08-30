import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing, typography } from '@/constants/Theme';

type Source = 'doe' | 'community';

interface SourceBadgeProps {
  source: Source;
}

const LABELS: Record<Source, string> = {
  doe: 'DOE Bulletin',
  community: 'Community Verified',
};

const COLORS: Record<Source, { bg: string; text: string }> = {
  doe: {
    bg: palette.primarySoft,
    text: palette.primaryDark,
  },
  community: {
    bg: palette.successSoft,
    text: palette.success,
  },
};

export default function SourceBadge({ source }: SourceBadgeProps) {
  const colors = COLORS[source];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.bg,
        },
      ]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: colors.text },
        ]}
      />
      <Text
        style={[
          styles.text,
          { color: colors.text },
        ]}>
        {LABELS[source]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
