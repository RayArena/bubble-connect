import React, { createContext, useContext, useEffect, useState } from 'react';
import { useClerk, useSignIn, useSignUp, useUser } from '@clerk/nextjs';
import type { Profile } from '@/types/db';

interface AuthContextType {
  user: { id: string } | null;
  session: null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string, displayName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user: clerkUser, isLoaded } = useUser();
  const { signOut: clerkSignOut } = useClerk();
  const { signIn: clerkSignIn } = useSignIn();
  const { signUp: clerkSignUp } = useSignUp();

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [session, setSession] = useState<null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const getAuthErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null && 'errors' in error) {
      const nested = (error as { errors?: Array<{ message?: string }> }).errors;
      if (Array.isArray(nested) && nested[0]?.message) {
        return nested[0].message;
      }
    }

    return fallback;
  };

  const fetchProfile = async () => {
    if (!clerkUser?.id) {
      setProfile(null);
      return;
    }

    const res = await fetch('/api/profile', { cache: 'no-store' });
    if (!res.ok) {
      setProfile(null);
      return;
    }

    const payload = await res.json();
    setProfile(payload.profile || null);
  };

  const refreshProfile = async () => {
    await fetchProfile();
  };

  useEffect(() => {
    if (!isLoaded) return;

    if (clerkUser) {
      setUser({ id: clerkUser.id });
      void fetchProfile().finally(() => setLoading(false));
      return;
    }

    setUser(null);
    setProfile(null);
    setLoading(false);
  }, [isLoaded, clerkUser]);

  const signUp = async (email: string, password: string, username: string, displayName: string) => {
    try {
      if (!clerkSignUp) {
        return { error: new Error('Authentication is not ready yet.') };
      }

      const result = await clerkSignUp.password({
        emailAddress: email,
        password,
        username,
        firstName: displayName,
      });

      if (result.error) {
        return { error: new Error(result.error.message || 'Sign up failed') };
      }

      if (clerkSignUp.status !== 'complete') {
        return { error: new Error('Sign up requires additional verification in Clerk settings.') };
      }

      const finalizeResult = await clerkSignUp.finalize();
      if (finalizeResult.error) {
        return { error: new Error(finalizeResult.error.message || 'Sign up finalization failed') };
      }

      const profileRes = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          displayName,
        }),
      });

      if (!profileRes.ok) {
        const payload = await profileRes.json();
        return { error: new Error(payload.error || 'Failed to create profile.') };
      }

      await fetchProfile();
      return { error: null };
    } catch (error: unknown) {
      return { error: new Error(getAuthErrorMessage(error, 'Sign up failed')) };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      if (!clerkSignIn) {
        return { error: new Error('Authentication is not ready yet.') };
      }

      const result = await clerkSignIn.password({
        identifier: email,
        password,
      });

      if (result.error) {
        return { error: new Error(result.error.message || 'Sign in failed') };
      }

      if (clerkSignIn.status !== 'complete') {
        return { error: new Error('Sign in requires additional verification in Clerk settings.') };
      }

      const finalizeResult = await clerkSignIn.finalize();
      if (finalizeResult.error) {
        return { error: new Error(finalizeResult.error.message || 'Sign in finalization failed') };
      }

      await fetchProfile();
      return { error: null };
    } catch (error: unknown) {
      return { error: new Error(getAuthErrorMessage(error, 'Sign in failed')) };
    }
  };

  const signOut = async () => {
    await clerkSignOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
