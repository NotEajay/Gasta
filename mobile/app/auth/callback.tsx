import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useGlobalSearchParams, useRouter, type Href } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { createSessionFromUrl } from '@/lib/auth';
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

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();

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
        router.replace('/(tabs)/prices');
        return;
      }

      const message = result.error ?? 'Sign-in did not finish. Try again.';
      router.replace(`/(auth)?error=${encodeURIComponent(message)}` as Href);
    })();
  }, [params.code, params.error, params.error_description, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={GasTaColors.forest} size="large" />
      <Text style={styles.text}>Signing you in…</Text>
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
  },
  text: {
    color: GasTaColors.textMuted,
    fontWeight: '600',
  },
});
