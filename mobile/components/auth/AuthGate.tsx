import { Redirect, Stack, useSegments, type Href } from 'expo-router';

import { AuthProvider, useAuth } from '@/context/AuthProvider';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, isLoading, isEmailVerified } = useAuth();
  const segments = useSegments();

  if (isLoading) {
    return null;
  }

  const inAuthGroup = segments[0] === '(auth)';
  const onVerifyEmail = (segments as string[]).includes('verify-email');

  if (session && isEmailVerified && inAuthGroup) {
    return <Redirect href="/(tabs)" />;
  }

  if (session && !isEmailVerified && inAuthGroup && !onVerifyEmail) {
    return (
      <Redirect
        href={
          `/(auth)/verify-email?email=${encodeURIComponent(session.user.email ?? '')}` as Href
        }
      />
    );
  }

  if (!session && !inAuthGroup) {
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
    <Stack>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
