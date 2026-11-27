import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Redirect, Stack, useSegments, type Href } from 'expo-router';

import { AuthProvider, useAuth } from '@/context/AuthProvider';
import { GasTaColors } from '@/constants/Theme';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, isLoading, isEmailVerified } = useAuth();
  const segments = useSegments();
  const root = segments[0] as string | undefined;
  const inTabs = root === '(tabs)';
  const inAuthGroup = root === '(auth)';
  const inOAuthCallback = root === 'auth';
  const onIndex = root === 'index' || root === undefined;
  // Shared-vehicle history is a signed-in detail screen that lives outside (tabs).
  const onSharedVehicle = root === 'shared-vehicle-history';
  const inAdmin = root === 'admin';
  const isPublicAuthSurface = inAuthGroup || inOAuthCallback;
  // Every route a signed-in user may actually see. Redirecting one of these
  // unmounts the navigator while Redirect's focus effect is still pending, which
  // spins React Navigation's state sync ("maximum update depth exceeded").
  const isAppSurface = inTabs || onSharedVehicle || inAdmin || inOAuthCallback;
  const isAuthenticated = Boolean(session && isEmailVerified);

  // Static web export must be able to render the public landing document while
  // the initial session resolves. Native index and every non-root route retain
  // the blocking boot state.
  if (isLoading) {
    if (Platform.OS === 'web' && onIndex) {
      return children;
    }

    return (
      <View style={styles.boot}>
        <ActivityIndicator color={GasTaColors.forest} size="large" />
      </View>
    );
  }

  // Signed-in users always land in the main app from public/auth/stray routes.
  if (isAuthenticated && !isAppSurface) {
    return <Redirect href="/(tabs)/home" />;
  }

  if (!isAuthenticated) {
    // OAuth callback must run before any verification redirect so it can finish
    // creating the session (or send an OAuth error back to the login screen).
    if (inOAuthCallback) {
      return children;
    }

    if (session && !isEmailVerified) {
      if (!(inAuthGroup && segments[1] === 'verify-email')) {
        return (
          <Redirect
            href={
              `/(auth)/verify-email?email=${encodeURIComponent(session.user.email ?? '')}` as Href
            }
          />
        );
      }

      return children;
    }

    // Root is the public web landing page; all other non-auth routes are
    // protected and send signed-out visitors to the canonical login URL.
    if (!onIndex && !isPublicAuthSurface) {
      return <Redirect href="/login" />;
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
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="shared-vehicle-history" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
    </Stack>
  );
}
