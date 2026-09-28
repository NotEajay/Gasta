import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Stack, useSegments, type Href } from 'expo-router';

import { AuthProvider, useAuth } from '@/context/AuthProvider';
import { GasTaColors } from '@/constants/Theme';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, isLoading, isEmailVerified } = useAuth();
  const segments = useSegments();
  const root = segments[0] as string | undefined;
  const inTabs = root === '(tabs)';
  const inAuthGroup = root === '(auth)';
  const inOAuthCallback = root === 'auth';
  const onLogin = root === 'login';
  const onIndex = root === 'index' || root === undefined;
  // Shared-vehicle history is a signed-in detail screen that lives outside (tabs).
  const onSharedVehicle = root === 'shared-vehicle-history';
  const isAuthSurface = inAuthGroup || inOAuthCallback || onLogin || onIndex;
  // Every route a signed-in user may actually see. Redirecting one of these
  // unmounts the navigator while Redirect's focus effect is still pending, which
  // spins React Navigation's state sync ("maximum update depth exceeded").
  const isAppSurface = inTabs || onSharedVehicle;
  const isAuthenticated = Boolean(session && isEmailVerified);

  // Always block during loading - never render auth surface or protected routes
  if (isLoading) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={GasTaColors.forest} size="large" />
      </View>
    );
  }

  // Signed-in users always land in the main app (never auth / not-found / stray routes)
  if (isAuthenticated && !isAppSurface) {
    return <Redirect href="/(tabs)/home" />;
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
      <Stack.Screen name="shared-vehicle-history" options={{ headerShown: false }} />
    </Stack>
  );
}
