import { Redirect, Stack, useSegments, type Href } from 'expo-router';

import { AuthProvider, useAuth } from '@/context/AuthProvider';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, isLoading, isEmailVerified } = useAuth();
  const segments = useSegments();

  if (isLoading) {
    return null;
  }

  const root = segments[0];
  const inAuthGroup = root === '(auth)';
  const inOAuthCallback = root === 'auth';
  const onLogin = root === 'login';
  const onIndex = root === 'index' || root === undefined;
  const isAuthSurface = inAuthGroup || inOAuthCallback || onLogin || onIndex;
  const isAuthenticated = Boolean(session && isEmailVerified);

  if (isAuthenticated && (inOAuthCallback || isAuthSurface)) {
    return <Redirect href="/(tabs)/prices" />;
  }

  if (!isAuthenticated && !isAuthSurface) {
    if (session && !isEmailVerified) {
      return (
        <Redirect
          href={
            `/(auth)/verify-email?email=${encodeURIComponent(session.user.email ?? '')}` as Href
          }
        />
      );
    }

    return <Redirect href="/(auth)" />;
  }

  return children;
}

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
