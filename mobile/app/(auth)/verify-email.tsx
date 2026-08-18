import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AnimatedPressable from '@/components/auth/AnimatedPressable';
import AuthButton from '@/components/auth/AuthButton';
import GlassSurface, { AuthBackground } from '@/components/ui/GlassSurface';
import { useAuth } from '@/context/AuthProvider';
import { goToSignIn } from '@/lib/navigation';
import { GasTaColors, GasTaSpacing } from '@/constants/Theme';
import { useResponsive } from '@/hooks/useResponsive';

export default function VerifyEmailScreen() {
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const { resendVerification } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    isCompact,
    isLandscape,
    scale,
    contentMaxWidth,
    horizontalPadding,
    verticalPadding,
  } = useResponsive();

  const email = typeof emailParam === 'string' ? emailParam : '';
  const titleSize = scale(isCompact ? 24 : 28);
  const subtitleSize = scale(isCompact ? 13 : 14);
  const bodySize = scale(isCompact ? 13 : 14);
  const labelSize = scale(isCompact ? 14 : 15);

  const handleResend = async () => {
    if (!email) {
      setError('Missing email address. Go back and sign up again.');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const result = await resendVerification(email);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage('Verification email sent. Check your inbox.');
  };

  return (
    <AuthBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView
            bounces={false}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingHorizontal: horizontalPadding,
                paddingVertical: verticalPadding,
                minHeight: isLandscape ? undefined : '100%',
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={[styles.inner, { maxWidth: contentMaxWidth }]}>
              <GlassSurface style={styles.card} variant="strong">
                <View style={styles.header}>
                  <Text style={[styles.cardTitle, { fontSize: titleSize }]}>Verify your email</Text>
                  <Text
                    style={[
                      styles.cardSubtitle,
                      { fontSize: subtitleSize, lineHeight: subtitleSize * 1.6 },
                    ]}>
                    {email
                      ? `We sent a verification link to ${email}. Open the link in your email, then come back and sign in.`
                      : 'We sent a verification link to your email. Open the link, then come back and sign in.'}
                  </Text>
                </View>

                {error && <Text style={[styles.errorText, { fontSize: bodySize }]}>{error}</Text>}
                {message && (
                  <Text style={[styles.successText, { fontSize: bodySize }]}>{message}</Text>
                )}

                <View style={styles.form}>
                  <AuthButton
                    disabled={!email}
                    fontSize={labelSize}
                    label="Resend verification email"
                    loading={loading}
                    onPress={handleResend}
                  />

                  <AnimatedPressable
                    accessibilityRole="button"
                    hoverScale={1}
                    pressScale={0.98}
                    style={styles.backRow}
                    onPress={goToSignIn}>
                    <Text style={[styles.backText, { fontSize: bodySize }]}>← Back to Sign In</Text>
                  </AnimatedPressable>
                </View>
              </GlassSurface>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    padding: GasTaSpacing.xl,
    gap: GasTaSpacing.lg,
  },
  header: {
    gap: GasTaSpacing.sm,
  },
  cardTitle: {
    color: GasTaColors.textPrimary,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    color: GasTaColors.textMuted,
  },
  form: {
    gap: GasTaSpacing.lg,
    marginTop: GasTaSpacing.sm,
  },
  backRow: {
    alignSelf: 'center',
    paddingVertical: GasTaSpacing.xs,
  },
  backText: {
    color: GasTaColors.forestDark,
    fontWeight: '600',
  },
  errorText: {
    color: GasTaColors.error,
    fontWeight: '600',
  },
  successText: {
    color: GasTaColors.forestDark,
    fontWeight: '600',
  },
});
