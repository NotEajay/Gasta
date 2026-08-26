import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, radii, spacing, typography } from '@/constants/theme';
import { useTheme } from '@/lib/useTheme';

type Source = 'doe' | 'community';

interface SourceBadgeProps {
  source: Source;
}

const LABELS: Record<Source, string> = {
  doe: 'DOE Bulletin',
  community: 'Community Verified',
};

const COLORS: Record<Source, { bg: string; bgDark: string; text: string; textDark: string }> = {
  doe: {
    bg: palette.primarySoft,
    bgDark: '#172554',
    text: palette.primaryDark,
    textDark: '#93C5FD',
  },
  community: {
    bg: palette.successSoft,
    bgDark: '#064E3B',
    text: palette.success,
    textDark: '#6EE7B7',
  },
};

export default function SourceBadge({ source }: SourceBadgeProps) {
  const theme = useTheme();
  const colors = COLORS[source];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: theme.scheme === 'dark' ? colors.bgDark : colors.bg,
        },
      ]}>
      <View
        style={[
          styles.dot,
          { backgroundColor: theme.scheme === 'dark' ? colors.textDark : colors.text },
        ]}
      />
      <Text
        style={[
          styles.text,
          { color: theme.scheme === 'dark' ? colors.textDark : colors.text },
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
