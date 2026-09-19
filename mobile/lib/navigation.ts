import { router, type Href } from 'expo-router';

/** Prices tab — the app home after any successful sign-in. */
export const HOME_HREF = '/(tabs)/prices' as const;

export function goHome() {
  router.replace(HOME_HREF);
}

export function goToSignIn() {
  router.replace({
    pathname: '/(auth)',
    params: { mode: 'signin' },
  });
}

export function goToSignUp() {
  router.replace({
    pathname: '/(auth)',
    params: { mode: 'signup' },
  });
}

export function goToVerifyEmail(email: string) {
  router.replace(`/(auth)/verify-email?email=${encodeURIComponent(email)}` as Href);
}
