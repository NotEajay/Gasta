import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useGlobalSearchParams, useRouter, type Href } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { createSessionFromUrl } from '@/lib/auth';
import { HOME_HREF } from '@/lib/navigation';
import { GasTaColors } from '@/constants/Theme';

WebBrowser.maybeCompleteAuthSession();

const capturedCallbackUrl = typeof window !== 'undefined' ? window.location.href : null;

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useGlobalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const started = useRef(false);
  const [statusText, setStatusText] = useState('Signing you in…');

  useEffect(() => {
    // If this page was opened inside Expo's auth browser, close it and let the
    // native app finish PKCE exchange (it has the code verifier).
    const completion = WebBrowser.maybeCompleteAuthSession();
    if (completion.type === 'success') {
      setStatusText('Returning to the app…');
      return;
    }

    if (started.current) {
      return;
    }
    started.current = true;

    void (async () => {
      const oauthError =
        (typeof params.error_description === 'string' && params.error_description) ||
        (typeof params.error === 'string' && params.error) ||
        null;

      if (oauthError) {
        router.replace(`/(auth)?error=${encodeURIComponent(oauthError)}` as Href);
        return;
      }

      const searchCode =
        typeof params.code === 'string'
          ? params.code
          : Array.isArray(params.code)
            ? params.code[0]
            : null;
      const hrefFromParams = searchCode
        ? `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}/auth/callback?code=${encodeURIComponent(searchCode)}`
        : null;
      const href =
        hrefFromParams ??
        capturedCallbackUrl ??
        (Platform.OS === 'web' ? window.location.href : await Linking.getInitialURL());

      const result = await createSessionFromUrl(href);

      if (result.session) {
        router.replace(HOME_HREF);
        return;
      }

      if (!result.error) {
        // Native Expo Go owns the verifier — don't spin forever in the browser.
        setStatusText('You can close this window and return to GasTa.');
        return;
      }

      router.replace(`/(auth)?error=${encodeURIComponent(result.error)}` as Href);
    })();
  }, [params.code, params.error, params.error_description, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={GasTaColors.forest} size="large" />
      <Text style={styles.text}>{statusText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: GasTaColors.cream,
    paddingHorizontal: 24,
  },
  text: {
    color: GasTaColors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
});
