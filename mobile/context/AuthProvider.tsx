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
  getSession,
  isEmailVerified,
  resendVerificationEmail,
  resetPasswordForEmail,
  signInWithPassword,
  signOut as authSignOut,
  signUpWithEmail,
} from '@/lib/auth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

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
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await signInWithPassword(email, password);
    return result;
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    return signUpWithEmail(email, password, fullName);
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
      signOut,
      resetPassword,
      resendVerification,
    }),
    [session, isLoading, signIn, signUp, signOut, resetPassword, resendVerification],
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
