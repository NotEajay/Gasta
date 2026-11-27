import { router, type Href } from 'expo-router';

/** Home tab — the app landing destination after authentication. */
export const HOME_HREF = '/(tabs)/home' as const;

export function goHome() {
  router.replace(HOME_HREF);
}

export function goToSignIn() {
  router.replace({
    pathname: '/login',
    params: { mode: 'signin' },
  });
}

export function goToSignUp() {
  router.replace({
    pathname: '/login',
    params: { mode: 'signup' },
  });
}

export function goToVerifyEmail(email: string) {
  router.replace(`/(auth)/verify-email?email=${encodeURIComponent(email)}` as Href);
}
