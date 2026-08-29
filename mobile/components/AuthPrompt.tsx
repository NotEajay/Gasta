import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import Card from '@/components/ui/Card';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { spacing, typography } from '@/constants/Theme';
import { useTheme } from '@/lib/useTheme';

interface AuthPromptProps {
  message: string;
  onSignIn: () => void;
}

export default function AuthPrompt({ message, onSignIn }: AuthPromptProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Card elevated style={styles.card}>
        <Text style={[styles.title, { color: theme.text }]}>Sign in required</Text>
        <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>
        <PrimaryButton label="Sign in" onPress={onSignIn} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    alignItems: 'stretch',
  },
  title: {
    ...typography.section,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.body,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
