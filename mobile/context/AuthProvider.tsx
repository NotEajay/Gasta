import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  createSessionFromUrl,
  getSession,
  isEmailVerified,
  resendVerificationEmail,
  resetPasswordForEmail,
  signInWithGoogle as authSignInWithGoogle,
  signInWithPassword,
  signOut as authSignOut,
  signUpWithEmail,
} from '@/lib/auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { ensureProfile } from '@/lib/profile';
import * as Linking from 'expo-linking';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isEmailVerified: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null; needsVerification: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  resendVerification: (email: string) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    getSession().then((currentSession) => {
      setSession(currentSession);
      setIsLoading(false);
      if (currentSession?.user) {
        void ensureProfile(currentSession.user);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);

      if (nextSession?.user && event !== 'TOKEN_REFRESHED') {
        setTimeout(() => {
          void ensureProfile(nextSession.user);
        }, 0);
      }
    });

    const handleUrl = ({ url }: { url: string }) => {
      void createSessionFromUrl(url);
    };

    const linking = Linking.addEventListener('url', handleUrl);

    if (typeof window === 'undefined' || !window.location.pathname.includes('/auth/callback')) {
      void Linking.getInitialURL().then((url) => {
        void createSessionFromUrl(url);
      });
    }

    return () => {
      data.subscription.unsubscribe();
      linking.remove();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await signInWithPassword(email, password);
    return result;
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    return signUpWithEmail(email, password, fullName);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    return authSignInWithGoogle();
  }, []);

  const signOut = useCallback(async () => {
    return authSignOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    return resetPasswordForEmail(email);
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    return resendVerificationEmail(email);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      isEmailVerified: isEmailVerified(session?.user ?? null),
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      resetPassword,
      resendVerification,
    }),
    [session, isLoading, signIn, signUp, signInWithGoogle, signOut, resetPassword, resendVerification],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
