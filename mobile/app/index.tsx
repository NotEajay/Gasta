import { Redirect } from 'expo-router';

export default function Index() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      return <Redirect href={`/auth/callback?code=${encodeURIComponent(code)}`} />;
    }
  }

  return <Redirect href="/(auth)" />;
}
