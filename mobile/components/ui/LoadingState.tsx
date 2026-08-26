import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { palette, spacing, typography } from '@/constants/theme';
import { useTheme } from '@/lib/useTheme';

export default function LoadingState({ message = 'Loading…' }: { message?: string }) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ActivityIndicator size="large" color={palette.primary} />
      <Text style={[styles.text, { color: theme.textSecondary }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  text: {
    marginTop: spacing.md,
    ...typography.body,
  },
});
