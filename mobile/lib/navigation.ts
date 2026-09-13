import { router, type Href } from 'expo-router';

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
