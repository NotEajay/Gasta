import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AnimatedPressable from '@/components/auth/AnimatedPressable';
import AuthButton from '@/components/auth/AuthButton';
import AuthTextField from '@/components/auth/AuthTextField';
import GlassSurface, { AuthBackground } from '@/components/ui/GlassSurface';
import { useAuth } from '@/context/AuthProvider';
import { validateSignInForm, validateSignUpForm } from '@/lib/auth';
import { goToSignIn, goToSignUp, goToVerifyEmail } from '@/lib/navigation';
import { GasTaColors, GasTaRadius, GasTaSpacing } from '@/constants/Theme';
import { useResponsive } from '@/hooks/useResponsive';

type AuthMode = 'signin' | 'signup';

export default function AuthScreen() {
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const { signIn, signUp, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

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

  useEffect(() => {
    if (modeParam === 'signin' || modeParam === 'signup') {
      setMode(modeParam);
      setError(null);
    }
  }, [modeParam]);

  const isSignIn = mode === 'signin';
  const titleSize = scale(isCompact ? 24 : 28);
  const subtitleSize = scale(isCompact ? 13 : 14);
  const labelSize = scale(isCompact ? 14 : 15);
  const bodySize = scale(isCompact ? 13 : 14);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);

    if (nextMode === 'signin') {
      goToSignIn();
      return;
    }

    goToSignUp();
  };

  const handleSubmit = async () => {
    setError(null);

    if (isSignIn) {
      const validationError = validateSignInForm({ email, password });
      if (validationError) {
        setError(validationError);
        return;
      }

      setLoading(true);
      const result = await signIn(email, password);
      setLoading(false);

      if (result.error) {
        if (result.error.includes('verify your email')) {
          goToVerifyEmail(email.trim());
          return;
        }

        setError(result.error);
        return;
      }

      router.replace('/(tabs)');
      return;
    }

    const validationError = validateSignUpForm({
      fullName,
      email,
      password,
      confirmPassword,
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const result = await signUp(email, password, fullName);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.needsVerification) {
      goToVerifyEmail(email.trim());
      return;
    }

    router.replace('/(tabs)');
  };

  const handleGoogleAuth = async () => {
    setError(null);
    setGoogleLoading(true);
    const result = await signInWithGoogle();
    setGoogleLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.pendingRedirect) {
      return;
    }

    router.replace('/(tabs)');
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
                <View style={styles.toggleRow}>
                  <AnimatedPressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSignIn }}
                    hoverScale={1.01}
                    pressScale={0.98}
                    style={[styles.toggle, isSignIn && styles.toggleActive]}
                    onPress={() => switchMode('signin')}>
                    <Text
                      style={[
                        styles.toggleText,
                        { fontSize: labelSize },
                        isSignIn && styles.toggleTextActive,
                      ]}>
                      Sign In
                    </Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: !isSignIn }}
                    hoverScale={1.01}
                    pressScale={0.98}
                    style={[styles.toggle, !isSignIn && styles.toggleActive]}
                    onPress={() => switchMode('signup')}>
                    <Text
                      style={[
                        styles.toggleText,
                        { fontSize: labelSize },
                        !isSignIn && styles.toggleTextActive,
                      ]}>
                      Sign Up
                    </Text>
                  </AnimatedPressable>
                </View>

                <View style={styles.header}>
                  <Text style={[styles.cardTitle, { fontSize: titleSize }]}>
                    {isSignIn ? 'Welcome back' : 'Create account'}
                  </Text>
                  <Text
                    style={[
                      styles.cardSubtitle,
                      { fontSize: subtitleSize, lineHeight: subtitleSize * 1.6 },
                    ]}>
                    {isSignIn
                      ? 'Track fuel prices and optimize every trip.'
                      : 'Start making smarter, lower-cost travel choices.'}
                  </Text>
                </View>

                {error && <Text style={[styles.errorText, { fontSize: bodySize }]}>{error}</Text>}

                <View style={styles.form}>
                  {!isSignIn && (
                    <AuthTextField
                      autoCapitalize="words"
                      autoComplete="name"
                      fontSize={bodySize}
                      label="Full name"
                      textContentType="name"
                      value={fullName}
                      onChangeText={setFullName}
                    />
                  )}

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

                  <AuthTextField
                    autoComplete={isSignIn ? 'password' : 'new-password'}
                    fontSize={bodySize}
                    label="Password"
                    secureTextEntry
                    textContentType={isSignIn ? 'password' : 'newPassword'}
                    value={password}
                    onChangeText={setPassword}
                  />

                  {!isSignIn && (
                    <AuthTextField
                      autoComplete="new-password"
                      fontSize={bodySize}
                      label="Confirm password"
                      secureTextEntry
                      textContentType="newPassword"
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                    />
                  )}

                  {isSignIn && (
                    <AnimatedPressable
                      accessibilityRole="button"
                      hoverScale={1}
                      pressScale={0.98}
                      style={styles.forgotRow}
                      onPress={() => router.push('/(auth)/forgot-password')}>
                      <Text style={[styles.forgotText, { fontSize: bodySize }]}>
                        Forgot password?
                      </Text>
                    </AnimatedPressable>
                  )}

                  <AuthButton
                    disabled={googleLoading}
                    fontSize={labelSize}
                    label={isSignIn ? 'Sign In' : 'Create Account'}
                    loading={loading}
                    onPress={handleSubmit}
                  />

                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={[styles.dividerText, { fontSize: bodySize - 1 }]}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <AuthButton
                    disabled={loading}
                    fontSize={labelSize}
                    label={isSignIn ? 'Continue with Google' : 'Sign up with Google'}
                    loading={googleLoading}
                    variant="secondary"
                    onPress={handleGoogleAuth}
                  />
                </View>
              </GlassSurface>

              <View style={styles.footer}>
                <Text style={[styles.footerText, { fontSize: bodySize }]}>
                  {isSignIn ? "Don't have an account? " : 'Already have an account? '}
                </Text>
                <AnimatedPressable
                  accessibilityRole="button"
                  hoverScale={1}
                  pressScale={0.98}
                  onPress={() => switchMode(isSignIn ? 'signup' : 'signin')}>
                  <Text style={[styles.footerLink, { fontSize: bodySize }]}>
                    {isSignIn ? 'Sign Up' : 'Sign In'}
                  </Text>
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
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(1, 68, 33, 0.06)',
    borderRadius: GasTaRadius.sm,
    padding: 5,
    gap: 6,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  toggle: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: GasTaColors.forest,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  },
  toggleText: {
    color: GasTaColors.textSoft,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  toggleTextActive: {
    color: GasTaColors.textOnForest,
    fontWeight: '800',
  },
  header: {
    gap: GasTaSpacing.sm,
    marginTop: GasTaSpacing.xs,
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
  forgotRow: {
    alignSelf: 'flex-end',
    paddingVertical: GasTaSpacing.xs,
  },
  forgotText: {
    color: GasTaColors.forestDark,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.md,
    marginVertical: GasTaSpacing.xs,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: GasTaColors.glassBorderSubtle,
  },
  dividerText: {
    color: GasTaColors.textSoft,
    fontWeight: '500',
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: GasTaSpacing.xl,
    paddingBottom: GasTaSpacing.sm,
    gap: GasTaSpacing.xs,
  },
  footerText: {
    color: GasTaColors.textMuted,
  },
  footerLink: {
    color: GasTaColors.forestDark,
    fontWeight: '700',
  },
});
