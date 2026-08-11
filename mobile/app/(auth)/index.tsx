import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import AuthButton from '@/components/auth/AuthButton';
import AuthTextField from '@/components/auth/AuthTextField';
import GlassSurface, { AuthBackground } from '@/components/ui/GlassSurface';
import { GasTaColors, GasTaRadius, GasTaSpacing } from '@/constants/Theme';
import { useResponsive } from '@/hooks/useResponsive';

type AuthMode = 'signin' | 'signup';

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const {
    isCompact,
    isLandscape,
    scale,
    contentMaxWidth,
    logoWidth,
    horizontalPadding,
    verticalPadding,
  } = useResponsive();

  const isSignIn = mode === 'signin';
  const titleSize = scale(isCompact ? 24 : 28);
  const subtitleSize = scale(isCompact ? 13 : 14);
  const labelSize = scale(isCompact ? 14 : 15);
  const bodySize = scale(isCompact ? 13 : 14);

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
              <View style={[styles.hero, isLandscape && styles.heroLandscape]}>
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSignIn }}
                    onPress={() => setMode('signin')}
                    style={[styles.toggle, isSignIn && styles.toggleActive]}>
                    <Text
                      style={[
                        styles.toggleText,
                        { fontSize: labelSize },
                        isSignIn && styles.toggleTextActive,
                      ]}>
                      Sign In
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: !isSignIn }}
                    onPress={() => setMode('signup')}
                    style={[styles.toggle, !isSignIn && styles.toggleActive]}>
                    <Text
                      style={[
                        styles.toggleText,
                        { fontSize: labelSize },
                        !isSignIn && styles.toggleTextActive,
                      ]}>
                      Sign Up
                    </Text>
                  </Pressable>
                </View>

                <Text style={[styles.cardTitle, { fontSize: titleSize }]}>
                  {isSignIn ? 'Welcome back' : 'Create account'}
                </Text>
                <Text style={[styles.cardSubtitle, { fontSize: subtitleSize }]}>
                  {isSignIn
                    ? 'Track fuel prices and optimize every trip.'
                    : 'Start making smarter, lower-cost travel choices.'}
                </Text>

                <View style={styles.form}>
                  {!isSignIn && (
                    <AuthTextField
                      autoCapitalize="words"
                      autoComplete="name"
                      fontSize={bodySize}
                      label="Full name"
                      textContentType="name"
                    />
                  )}

                  <AuthTextField
                    autoCapitalize="none"
                    autoComplete="email"
                    fontSize={bodySize}
                    keyboardType="email-address"
                    label="Email address"
                    textContentType="emailAddress"
                  />

                  <AuthTextField
                    autoComplete={isSignIn ? 'password' : 'new-password'}
                    fontSize={bodySize}
                    label="Password"
                    secureTextEntry
                    textContentType={isSignIn ? 'password' : 'newPassword'}
                  />

                  {!isSignIn && (
                    <AuthTextField
                      autoComplete="new-password"
                      fontSize={bodySize}
                      label="Confirm password"
                      secureTextEntry
                      textContentType="newPassword"
                    />
                  )}

                  {isSignIn && (
                    <Pressable accessibilityRole="button" style={styles.forgotRow}>
                      <Text style={[styles.forgotText, { fontSize: bodySize }]}>
                        Forgot password?
                      </Text>
                    </Pressable>
                  )}

                  <AuthButton
                    fontSize={labelSize}
                    label={isSignIn ? 'Sign In' : 'Create Account'}
                    onPress={() => undefined}
                  />

                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={[styles.dividerText, { fontSize: bodySize - 1 }]}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <AuthButton
                    fontSize={labelSize}
                    label={isSignIn ? 'Continue with Google' : 'Sign up with Google'}
                    variant="secondary"
                    onPress={() => undefined}
                  />
                </View>
              </GlassSurface>

              <View style={styles.footer}>
                <Text style={[styles.footerText, { fontSize: bodySize }]}>
                  {isSignIn ? "Don't have an account? " : 'Already have an account? '}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setMode(isSignIn ? 'signup' : 'signin')}>
                  <Text style={[styles.footerLink, { fontSize: bodySize }]}>
                    {isSignIn ? 'Sign Up' : 'Sign In'}
                  </Text>
                </Pressable>
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
  card: {
    padding: GasTaSpacing.lg,
    gap: GasTaSpacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(1, 68, 33, 0.06)',
    borderRadius: GasTaRadius.sm,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
  },
  toggle: {
    flex: 1,
    paddingVertical: 11,
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
  },
  toggleTextActive: {
    color: GasTaColors.textOnForest,
    fontWeight: '800',
  },
  cardTitle: {
    color: GasTaColors.textPrimary,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    color: GasTaColors.textMuted,
    lineHeight: 22,
    marginTop: -4,
  },
  form: {
    gap: GasTaSpacing.md,
    marginTop: GasTaSpacing.xs,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: -4,
  },
  forgotText: {
    color: GasTaColors.forestDark,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
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
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: GasTaSpacing.lg,
    paddingBottom: GasTaSpacing.sm,
  },
  footerText: {
    color: GasTaColors.textMuted,
  },
  footerLink: {
    color: GasTaColors.forestDark,
    fontWeight: '700',
  },
});
