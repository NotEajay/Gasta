import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import LabeledInput from '@/components/ui/LabeledInput';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { useAuth } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signUp, session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) {
      router.replace('/(tabs)/vehicles');
    }
  }, [session, router]);

  const handleAuth = useCallback(
    async (mode: 'signIn' | 'signUp') => {
      if (!email || !password) {
        Alert.alert('Missing fields', 'Enter email and password.');
        return;
      }
      setLoading(true);
      const error = mode === 'signIn' ? await signIn(email, password) : await signUp(email, password);
      setLoading(false);
      if (error) {
        Alert.alert('Authentication failed', error);
        return;
      }
      if (mode === 'signUp') {
        Alert.alert('Account created', 'You can now use Vehicles, Trip save, and Budget features.');
      }
      router.back();
    },
    [email, password, signIn, signUp, router]
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.container}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'android' ? 'height' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>GasTa Account</Text>
        <Text style={styles.subtitle}>
          Sign in to save vehicles, trip records, and fuel budgets.
        </Text>
        <LabeledInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <LabeledInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
        />
        <PrimaryButton
          label={loading ? 'Please wait…' : 'Sign in'}
          onPress={() => handleAuth('signIn')}
          disabled={loading}
        />
        <PrimaryButton
          label="Create account"
          variant="secondary"
          onPress={() => handleAuth('signUp')}
          disabled={loading}
          style={styles.secondary}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    marginBottom: 24,
    opacity: 0.8,
    lineHeight: 22,
  },
  secondary: {
    marginTop: 12,
  },
});
