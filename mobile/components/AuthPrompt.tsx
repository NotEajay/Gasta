import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import PrimaryButton from '@/components/ui/PrimaryButton';

interface AuthPromptProps {
  message: string;
  onSignIn: () => void;
}

export default function AuthPrompt({ message, onSignIn }: AuthPromptProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      <PrimaryButton label="Sign in" onPress={onSignIn} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
});
