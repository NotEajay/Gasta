import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Stack, useSegments, type Href } from 'expo-router';

import { AuthProvider, useAuth } from '@/context/AuthProvider';
import { GasTaColors } from '@/constants/Theme';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, isLoading, isEmailVerified } = useAuth();
  const segments = useSegments();
  const root = segments[0];
  const inAuthGroup = root === '(auth)';
  const inOAuthCallback = root === 'auth';
  const onLogin = root === 'login';
  const onIndex = root === 'index' || root === undefined;
  const isAuthSurface = inAuthGroup || inOAuthCallback || onLogin || onIndex;
  const isAuthenticated = Boolean(session && isEmailVerified);

  // Always block during loading - never render auth surface or protected routes
  if (isLoading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={GasTaColors.forest} size="large" />
      </View>
    );
  }

  // If authenticated, redirect from auth surfaces to main app
  if (isAuthenticated && (inOAuthCallback || isAuthSurface)) {
    return <Redirect href="/(tabs)/prices" />;
  }

  // If not authenticated, redirect to appropriate auth screen
  if (!isAuthenticated) {
    // Email verification required
    if (session && !isEmailVerified) {
      return (
        <Redirect
          href={
            `/(auth)/verify-email?email=${encodeURIComponent(session.user.email ?? '')}` as Href
          }
        />
      );
    }

    // Must be on auth surface if not authenticated
    if (!isAuthSurface) {
      return <Redirect href="/(auth)" />;
    }
  }

  return children;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.cream,
  },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}

export function RootStack() {
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
