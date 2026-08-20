import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { createSessionFromUrl, waitForSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { GasTaColors } from '@/constants/Theme';

WebBrowser.maybeCompleteAuthSession();

const capturedCallbackUrl = typeof window !== 'undefined' ? window.location.href : null;

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useGlobalSearchParams<{ code?: string; error?: string; error_description?: string }>();

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();

    let cancelled = false;

    void (async () => {
      const searchCode = typeof params.code === 'string' ? params.code : Array.isArray(params.code) ? params.code[0] : null;
      const hrefFromParams = searchCode
        ? `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}/auth/callback?code=${encodeURIComponent(searchCode)}`
        : null;
      const href =
        hrefFromParams ??
        capturedCallbackUrl ??
        (Platform.OS === 'web' ? window.location.href : await Linking.getInitialURL());

      const result = await createSessionFromUrl(href);

      if (cancelled) {
        return;
      }

      if (result.error && !params.code) {
        router.replace('/(auth)');
        return;
      }

      const session = (await supabase.auth.getSession()).data.session ?? (await waitForSession());

      if (cancelled) {
        return;
      }

      if (session) {
        router.replace('/(tabs)');
        return;
      }

      router.replace('/(auth)');
    })();

    return () => {
      cancelled = true;
    };
  }, [params.code, router]);

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
