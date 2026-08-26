import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AnimatedPressable from '@/components/auth/AnimatedPressable';
import AuthButton from '@/components/auth/AuthButton';
import AuthTextField from '@/components/auth/AuthTextField';
import GlassSurface, { AuthBackground } from '@/components/ui/GlassSurface';
import {
  sendPasswordResetCode,
  verifyPasswordResetCode,
  updatePasswordAfterRecovery,
} from '@/lib/auth';
import { GasTaColors, GasTaRadius, GasTaSpacing } from '@/constants/Theme';
import { useResponsive } from '@/hooks/useResponsive';

type Step = 'request' | 'verify';

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    isCompact,
    isDesktop,
    isLandscape,
    scale,
    contentMaxWidth,
    logoWidth,
    horizontalPadding,
    verticalPadding,
  } = useResponsive();

  const titleSize = scale(isCompact ? 24 : 28);
  const subtitleSize = scale(isCompact ? 13 : 14);
  const bodySize = scale(isCompact ? 13 : 14);
  const labelSize = scale(isCompact ? 14 : 15);

  const handleSendCode = async () => {
    setError(null);

    if (!email.trim()) {
      setError('Email address is required.');
      return;
    }

    setLoading(true);
    const result = await sendPasswordResetCode(email);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setStep('verify');
  };

  const handleResetPassword = async () => {
    setError(null);

    if (!code.trim()) {
      setError('Enter the code from your email.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    const verifyResult = await verifyPasswordResetCode(email, code);
    if (verifyResult.error) {
      setLoading(false);
      setError(verifyResult.error);
      return;
    }

    const updateResult = await updatePasswordAfterRecovery(newPassword);
    setLoading(false);

    if (updateResult.error) {
      setError(updateResult.error);
      return;
    }

    router.replace('/(auth)?mode=signin');
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
              <View
                style={[
                  styles.hero,
                  isLandscape && styles.heroLandscape,
                  isDesktop && styles.heroDesktop,
                ]}>
                <Image
                  accessibilityLabel="GasTa! logo"
                  resizeMode="contain"
                  source={require('@/assets/images/gasta-logo.png')}
                  style={{
                    width: logoWidth,
                    height: logoWidth * 0.85,
                  }}
                />
              </View>

              <GlassSurface style={styles.card} variant="strong">
                <View style={styles.header}>
                  <Text style={[styles.cardTitle, { fontSize: titleSize }]}>
                    {step === 'request' ? 'Reset password' : 'Enter code'}
                  </Text>
                  <Text
                    style={[
                      styles.cardSubtitle,
                      { fontSize: subtitleSize, lineHeight: subtitleSize * 1.6 },
                    ]}>
                    {step === 'request'
                      ? "Enter your email and we'll send you a 6-digit code."
                      : `Enter the code sent to ${email} and choose a new password.`}
                  </Text>
                </View>

                {error && <Text style={[styles.errorText, { fontSize: bodySize }]}>{error}</Text>}

                {step === 'request' ? (
                  <View style={styles.form}>
                    <AuthTextField
                      autoCapitalize="none"
                      autoComplete="email"
                      fontSize={bodySize}
                      keyboardType="email-address"
                      label="Email address"
                      textContentType="emailAddress"
                      value={email}
                      onChangeText={setEmail}
                    />

                    <AuthButton
                      fontSize={labelSize}
                      label="Send Code"
                      loading={loading}
                      onPress={handleSendCode}
                    />
                  </View>
                ) : (
                  <View style={styles.form}>
                    <AuthTextField
                      autoCapitalize="none"
                      fontSize={bodySize}
                      keyboardType="number-pad"
                      label="6-digit code"
                      maxLength={6}
                      value={code}
                      onChangeText={setCode}
                    />

                    <AuthTextField
                      autoComplete="new-password"
                      fontSize={bodySize}
                      label="New password"
                      secureTextEntry
                      textContentType="newPassword"
                      value={newPassword}
                      onChangeText={setNewPassword}
                    />

                    <AuthTextField
                      autoComplete="new-password"
                      fontSize={bodySize}
                      label="Confirm new password"
                      secureTextEntry
                      textContentType="newPassword"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                    />

                    <AuthButton
                      fontSize={labelSize}
                      label="Reset Password"
                      loading={loading}
                      onPress={handleResetPassword}
                    />

                    <AnimatedPressable
                      accessibilityRole="button"
                      hoverScale={1}
                      pressScale={0.98}
                      style={styles.resendRow}
                      onPress={handleSendCode}>
                      <Text style={[styles.resendText, { fontSize: bodySize }]}>
                        Didn't get a code? Resend
                      </Text>
                    </AnimatedPressable>
                  </View>
                )}
              </GlassSurface>

              <View style={styles.footer}>
                <AnimatedPressable
                  accessibilityRole="button"
                  hoverScale={1}
                  pressScale={0.98}
                  onPress={() => router.replace('/(auth)?mode=signin')}>
                  <Text style={[styles.footerLink, { fontSize: bodySize }]}>Back to Sign In</Text>
                </AnimatedPressable>
              </View>
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
  hero: {
    alignItems: 'center',
    marginBottom: GasTaSpacing.xl,
  },
  heroLandscape: {
    marginBottom: GasTaSpacing.md,
  },
  heroDesktop: {
    marginBottom: GasTaSpacing.lg,
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
  errorText: {
    color: GasTaColors.error,
    fontWeight: '600',
  },
  form: {
    gap: GasTaSpacing.lg,
    marginTop: GasTaSpacing.sm,
  },
  resendRow: {
    alignSelf: 'center',
    paddingVertical: GasTaSpacing.xs,
  },
  resendText: {
    color: GasTaColors.forestDark,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: GasTaSpacing.xl,
    paddingBottom: GasTaSpacing.sm,
  },
  footerLink: {
    color: GasTaColors.forestDark,
    fontWeight: '700',
  },
});