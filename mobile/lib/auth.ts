import * as Linking from 'expo-linking';
import type { AuthError, Session, User } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AuthResult = {
  error: string | null;
};

export type SignUpResult = AuthResult & {
  needsVerification: boolean;
};

const DUPLICATE_EMAIL_ERROR = 'An account with this email already exists. Try signing in instead.';

function getRedirectUrl() {
  return Linking.createURL('/');
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// With email confirmation enabled, Supabase obfuscates existing-user signups by
// returning a fake user with no identities instead of an error.
function isExistingUserSignUp(user: User | null) {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}

function mapAuthError(error: AuthError | null): string | null {
  if (!error) {
    return null;
  }

  if (/already\s+(been\s+)?registered/i.test(error.message)) {
    return DUPLICATE_EMAIL_ERROR;
  }

  switch (error.message) {
    case 'Invalid login credentials':
      return 'Incorrect email or password.';
    default:
      return error.message;
  }
}

export function isEmailVerified(user: User | null) {
  return Boolean(user?.email_confirmed_at);
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) {
    return null;
  }

  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });

  if (error) {
    return { error: mapAuthError(error) };
  }

  if (data.user && !isEmailVerified(data.user)) {
    await supabase.auth.signOut();
    return { error: 'Please verify your email before signing in.' };
  }

  return { error: null };
}

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
): Promise<SignUpResult> {
  if (!isSupabaseConfigured) {
    return {
      error: 'Supabase is not configured. Add your env keys in mobile/.env.',
      needsVerification: false,
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(email),
    password,
    options: {
      data: {
        full_name: fullName.trim(),
      },
      emailRedirectTo: getRedirectUrl(),
    },
  });

  if (error) {
    return { error: mapAuthError(error), needsVerification: false };
  }

  if (isExistingUserSignUp(data.user)) {
    await supabase.auth.signOut();
    return { error: DUPLICATE_EMAIL_ERROR, needsVerification: false };
  }

  const needsVerification = !isEmailVerified(data.user);

  if (needsVerification) {
    await supabase.auth.signOut();
  }

  return { error: null, needsVerification };
}

export async function resetPasswordForEmail(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: getRedirectUrl(),
  });

  return { error: mapAuthError(error) };
}

export async function sendPasswordResetCode(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: {
      shouldCreateUser: false,
    },
  });

  return { error: mapAuthError(error) };
}

export async function verifyPasswordResetCode(email: string, token: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token: token.trim(),
    type: 'email',
  });

  return { error: mapAuthError(error) };
}

export async function updatePasswordAfterRecovery(newPassword: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: mapAuthError(error) };
}

export async function resendVerificationEmail(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: normalizeEmail(email),
    options: {
      emailRedirectTo: getRedirectUrl(),
    },
  });

  return { error: mapAuthError(error) };
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();
  return { error: mapAuthError(error) };
}

export function validateSignUpForm(input: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}): string | null {
  if (!input.fullName.trim()) {
    return 'Full name is required.';
  }

  if (!input.email.trim()) {
    return 'Email address is required.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return 'Enter a valid email address.';
  }

  if (input.password.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  if (input.password !== input.confirmPassword) {
    return 'Passwords do not match.';
  }

  return null;
}

export function validateSignInForm(input: { email: string; password: string }): string | null {
  if (!input.email.trim()) {
    return 'Email address is required.';
  }

  if (!input.password) {
    return 'Password is required.';
  }

  return null;
}