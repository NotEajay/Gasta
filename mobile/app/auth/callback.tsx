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

function hasLocalPkceVerifier() {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.includes('code-verifier')) {
        return true;
      }
    }
  } catch {
    // ignore
  }

  return false;
}

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
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const current = new URL(window.location.href);
        const native = current.searchParams.get('native');
        if (native) {
          const dest = new URL(native);
          current.searchParams.forEach((value, key) => {
            if (key === 'native') return;
            dest.searchParams.set(key, value);
          });
          window.location.replace(dest.toString());
          return;
        }
      } catch {
        // continue with normal callback
      }
    }

    const tryClose = () => {
      const completion = WebBrowser.maybeCompleteAuthSession();
      if (completion.type === 'success') {
        setStatusText('Returning to the app…');
        return true;
      }
      return false;
    };

    tryClose();
    const closeTimer = setInterval(() => {
      if (tryClose()) {
        clearInterval(closeTimer);
      }
    }, 200);
    const stopTrying = setTimeout(() => clearInterval(closeTimer), 5000);

    if (started.current) {
      return () => {
        clearInterval(closeTimer);
        clearTimeout(stopTrying);
      };
    }
    started.current = true;

    void (async () => {
      const oauthError =
        (typeof params.error_description === 'string' && params.error_description) ||
        (typeof params.error === 'string' && params.error) ||
        null;

      if (oauthError) {
        clearInterval(closeTimer);
        clearTimeout(stopTrying);
        router.replace(`/(auth)?error=${encodeURIComponent(oauthError)}` as Href);
        return;
      }

      const searchCode =
        typeof params.code === 'string'
          ? params.code
          : Array.isArray(params.code)
            ? params.code[0]
            : null;

      // Mobile OAuth (Expo Go): this HTTPS page never has the verifier.
      // Do not exchange — just dismiss / tell the user to return to the app.
      if (Platform.OS === 'web' && !hasLocalPkceVerifier()) {
        setStatusText('Return to GasTa — sign-in finishes in the app.');
        return;
      }

      const hrefFromParams = searchCode
        ? `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost'}/auth/callback?code=${encodeURIComponent(searchCode)}`
        : null;
      const href =
        hrefFromParams ??
        capturedCallbackUrl ??
        (Platform.OS === 'web' ? window.location.href : await Linking.getInitialURL());

      const result = await createSessionFromUrl(href);

      if (result.session) {
        clearInterval(closeTimer);
        clearTimeout(stopTrying);
        router.replace(HOME_HREF);
        return;
      }

      if (!result.error) {
        setStatusText('Return to GasTa — sign-in finishes in the app.');
        return;
      }

      clearInterval(closeTimer);
      clearTimeout(stopTrying);
      router.replace(`/(auth)?error=${encodeURIComponent(result.error)}` as Href);
    })();

    return () => {
      clearInterval(closeTimer);
      clearTimeout(stopTrying);
    };
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
