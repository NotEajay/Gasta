import { makeRedirectUri } from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const initialWebHref = typeof window !== 'undefined' ? window.location.href : null;
const usedAuthCodes = new Set<string>();
let oauthCompletion: Promise<AuthResult> | null = null;

export type AuthResult = {
  error: string | null;
  pendingRedirect?: boolean;
  session?: Session | null;
};

export type SignUpResult = AuthResult & {
  needsVerification: boolean;
};

function getRedirectUrl() {
  return Linking.createURL('/');
}

export function getOAuthRedirectUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}/auth/callback`;
  }

  return makeRedirectUri({
    scheme: 'gasta',
    path: 'auth/callback',
  });
}

function withRedirectTo(oauthUrl: string, redirectTo: string) {
  try {
    const url = new URL(oauthUrl);
    url.searchParams.set('redirect_to', redirectTo);
    return url.toString();
  } catch {
    return oauthUrl;
  }
}

function parseAuthParams(url: string) {
  const params = new URLSearchParams();
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  if (queryIndex >= 0) {
    const queryEnd = hashIndex > queryIndex ? hashIndex : url.length;
    new URLSearchParams(url.slice(queryIndex + 1, queryEnd)).forEach((value, key) => {
      params.set(key, value);
    });
  }

  if (hashIndex >= 0) {
    new URLSearchParams(url.slice(hashIndex + 1)).forEach((value, key) => {
      params.set(key, value);
    });
  }

  return params;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

export async function createSessionFromUrl(url: string | null): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: null };
  }

  const href = url || initialWebHref;
  if (!href) {
    const { data } = await supabase.auth.getSession();
    return { error: null, session: data.session };
  }

  const params = parseAuthParams(href);
  const errorDescription = params.get('error_description') ?? params.get('error');

  if (errorDescription && errorDescription !== 'null') {
    return { error: decodeURIComponent(errorDescription.replace(/\+/g, ' ')) };
  }

  const code = params.get('code');
  if (code) {
    if (oauthCompletion) {
      return oauthCompletion;
    }

    oauthCompletion = (async () => {
      const existing = await supabase.auth.getSession();
      if (existing.data.session) {
        return { error: null, session: existing.data.session };
      }

      if (usedAuthCodes.has(code)) {
        const waited = await waitForSession(2500);
        return { error: waited ? null : 'Sign-in did not finish. Try again.', session: waited };
      }

      usedAuthCodes.add(code);
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        const waited = await waitForSession(2500);
        if (waited) {
          return { error: null, session: waited };
        }
        return { error: mapAuthError(error) };
      }

      return { error: null, session: data.session };
    })().finally(() => {
      setTimeout(() => {
        oauthCompletion = null;
      }, 1000);
    });

    return withTimeout(oauthCompletion, 8000, {
      error: 'Sign-in is taking too long. Try again.',
      session: null,
    });
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return { error: mapAuthError(error), session: data.session };
  }

  const { data } = await supabase.auth.getSession();
  return { error: null, session: data.session };
}

export async function waitForSession(timeoutMs = 8000) {
  const current = await supabase.auth.getSession();
  if (current.data.session) {
    return current.data.session;
  }

  return new Promise<Session | null>((resolve) => {
    const timeout = setTimeout(() => {
      subscription.unsubscribe();
      resolve(null);
    }, timeoutMs);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        return;
      }

      clearTimeout(timeout);
      subscription.unsubscribe();
      resolve(session);
    });
  });
}

export async function signInWithGoogle(): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  try {
    const redirectTo = getOAuthRedirectUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data.url) {
      return { error: mapAuthError(error) ?? 'Unable to start Google sign-in.' };
    }

    const oauthUrl = withRedirectTo(data.url, redirectTo);

    if (Platform.OS === 'web') {
      window.location.assign(oauthUrl);
      return { error: null, pendingRedirect: true };
    }

    const result = await WebBrowser.openAuthSessionAsync(oauthUrl, redirectTo, {
      showInRecents: true,
    });

    if (result.type === 'success' && result.url) {
      return createSessionFromUrl(result.url);
    }

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { error: null };
    }

    return { error: 'Google sign-in did not complete.' };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Unable to start Google sign-in.';
    if (message.toLowerCase().includes('popup') || message.toLowerCase().includes('blocked')) {
      return { error: 'Google sign-in could not open. Try again, or use email and password.' };
    }
    return { error: message };
  }
}

const DUPLICATE_EMAIL_MESSAGE =
  'An account with this email already exists. Try signing in instead.';

function mapAuthError(error: AuthError | null): string | null {
  if (!error) {
    return null;
  }

  const message = error.message.toLowerCase();

  if (error.message === 'Invalid login credentials') {
    return 'Incorrect email or password.';
  }

  if (message.includes('provider is not enabled') || message.includes('unsupported provider')) {
    return 'Google sign-in is not enabled. Turn on the Google provider in Supabase Auth.';
  }

  if (
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('user already exists') ||
    message.includes('duplicate key') ||
    message.includes('already exists')
  ) {
    return DUPLICATE_EMAIL_MESSAGE;
  }

  return error.message;
}

function looksLikeExistingAccount(user: User | null): boolean {
  if (!user) {
    return false;
  }

  // With email confirmation enabled, Supabase returns a user with no identities
  // instead of an error when the email is already registered.
  return Array.isArray(user.identities) && user.identities.length === 0;
}

export function isEmailVerified(user: User | null) {
  if (!user) {
    return false;
  }

  if (user.email_confirmed_at) {
    return true;
  }

  const provider = user.app_metadata?.provider;
  const providers = user.app_metadata?.providers;
  if (provider === 'google' || (Array.isArray(providers) && providers.includes('google'))) {
    return true;
  }

  return (user.identities ?? []).some((identity) => identity.provider === 'google');
}

export async function getSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) {
    return null;
  }

  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function validateSessionInBackground() {
  if (!isSupabaseConfigured) {
    return;
  }

  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    return;
  }

  const { error } = await supabase.auth.getUser();
  if (error) {
    await supabase.auth.signOut();
  }
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
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
    email: email.trim().toLowerCase(),
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

  if (looksLikeExistingAccount(data.user)) {
    return { error: DUPLICATE_EMAIL_MESSAGE, needsVerification: false };
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

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: getRedirectUrl(),
  });

  return { error: mapAuthError(error) };
}

export async function sendPasswordResetCode(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase is not configured. Add your env keys in mobile/.env.' };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
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
    email: email.trim().toLowerCase(),
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
    email: email.trim().toLowerCase(),
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