import React, { createContext, useContext, useEffect, useState } from 'react';
import { useClerk, useSignIn, useSignUp, useUser } from '@clerk/nextjs';
import type { Profile } from '@/types/db';

interface AuthContextType {
  user: { id: string } | null;
  session: null;
  profile: Profile | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    username: string,
    displayName: string
  ) => Promise<{ error: Error | null; requiresVerification: boolean }>;
  completeSignUpVerification: (
    code: string,
    username: string,
    displayName: string
  ) => Promise<{ error: Error | null }>;
  resendSignUpVerification: () => Promise<{ error: Error | null }>;
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

  type AuthMode = 'signIn' | 'signUp';
  type ClerkErrorItem = { code?: string; longMessage?: string; message?: string };

  const supportsSignUpField = (field: string) => {
    if (!clerkSignUp) return false;

    const requiredFields = Array.isArray(clerkSignUp.requiredFields) ? clerkSignUp.requiredFields : [];
    const optionalFields = Array.isArray(clerkSignUp.optionalFields) ? clerkSignUp.optionalFields : [];

    return (
      requiredFields.includes(field as never) ||
      optionalFields.includes(field as never)
    );
  };

  const splitDisplayName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return { firstName: '', lastName: '' };

    const parts = trimmed.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ');

    return { firstName, lastName };
  };

  const mapKnownAuthError = (message: string, mode: AuthMode, code?: string) => {
    const normalizedMessage = message.toLowerCase();
    const normalizedCode = (code || '').toLowerCase();

    if (
      normalizedCode === 'form_password_pwned' ||
      normalizedMessage.includes('online data breach') ||
      normalizedMessage.includes('compromised password')
    ) {
      return 'This password is not allowed because it appears in known data breaches. Use a unique password that you do not use on any other site.';
    }

    if (mode === 'signUp' && normalizedCode === 'form_identifier_exists') {
      return 'An account with this email already exists. Please sign in instead.';
    }

    if (mode === 'signIn' && normalizedCode === 'form_identifier_not_found') {
      return 'No account found for this email. Please sign up first.';
    }

    if (
      mode === 'signIn' &&
      (normalizedCode === 'form_password_incorrect' || normalizedMessage.includes('password is incorrect'))
    ) {
      return 'Incorrect password. Please try again.';
    }

    if (mode === 'signIn' && normalizedCode === 'session_exists') {
      return 'You are already signed in. Please refresh the page.';
    }

    return message;
  };

  const getAuthErrorMessage = (error: unknown, fallback: string, mode: AuthMode) => {
    let message = fallback;
    let code: string | undefined;

    if (typeof error === 'object' && error !== null) {
      const maybeClerk = error as {
        longMessage?: string;
        message?: string;
        code?: string;
        errors?: ClerkErrorItem[];
      };

      if (typeof maybeClerk.code === 'string' && maybeClerk.code) {
        code = maybeClerk.code;
      }

      if (typeof maybeClerk.longMessage === 'string' && maybeClerk.longMessage) {
        message = maybeClerk.longMessage;
      }

      const nested = maybeClerk.errors;
      if (Array.isArray(nested) && nested[0]) {
        if (nested[0].code) {
          code = nested[0].code;
        }
        if (nested[0].longMessage) {
          message = nested[0].longMessage;
        } else if (nested[0].message) {
          message = nested[0].message;
        }
      }

      if (message === fallback && typeof maybeClerk.message === 'string' && maybeClerk.message) {
        message = maybeClerk.message;
      }
    }

    if (message === fallback && error instanceof Error && error.message) {
      message = error.message;
    }

    return mapKnownAuthError(message, mode, code);
  };

  const parseJsonSafely = async (response: Response) => {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const ensureProfile = async (username: string, displayName: string) => {
    const retryDelays = [0, 300, 700, 1200, 2000, 3000];

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt] > 0) {
        await wait(retryDelays[attempt]);
      }

      try {
        const profileRes = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            displayName,
          }),
        });

        if (profileRes.ok) {
          return { error: null };
        }

        const payload = await parseJsonSafely(profileRes);
        const message = typeof payload?.error === 'string' ? payload.error : 'Failed to create profile.';

        if ((profileRes.status === 401 || profileRes.status === 403) && attempt < retryDelays.length - 1) {
          continue;
        }

        const profileCheckRes = await fetch('/api/profile', { cache: 'no-store' }).catch(() => null);
        if (profileCheckRes?.ok) {
          const profilePayload = await parseJsonSafely(profileCheckRes);
          if (profilePayload && 'profile' in profilePayload && profilePayload.profile) {
            return { error: null };
          }
        }

        return { error: new Error(message) };
      } catch {
        if (attempt < retryDelays.length - 1) {
          continue;
        }

        const profileCheckRes = await fetch('/api/profile', { cache: 'no-store' }).catch(() => null);
        if (profileCheckRes?.ok) {
          const profilePayload = await parseJsonSafely(profileCheckRes);
          if (profilePayload && 'profile' in profilePayload && profilePayload.profile) {
            return { error: null };
          }
        }

        return { error: new Error('Network error while creating your profile. Please try again.') };
      }
    }

    return { error: new Error('Failed to create profile.') };
  };

  const fetchProfile = async () => {
    if (!clerkUser?.id) {
      setProfile(null);
      return null;
    }

    const retryDelays = [0, 300, 700, 1200, 2000];

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt] > 0) {
        await wait(retryDelays[attempt]);
      }

      try {
        const res = await fetch('/api/profile', { cache: 'no-store' });
        if (!res.ok) {
          const shouldRetryAuth = (res.status === 401 || res.status === 403) && attempt < retryDelays.length - 1;
          if (shouldRetryAuth) {
            continue;
          }

          if (attempt < retryDelays.length - 1) {
            continue;
          }

          setProfile(null);
          return null;
        }

        const payload = await parseJsonSafely(res);
        const nextProfile =
          payload && typeof payload === 'object' && 'profile' in payload
            ? ((payload as { profile?: Profile | null }).profile ?? null)
            : null;

        if (!nextProfile && attempt < retryDelays.length - 1) {
          continue;
        }

        setProfile(nextProfile);
        return nextProfile;
      } catch {
        if (attempt < retryDelays.length - 1) {
          continue;
        }

        setProfile(null);
        return null;
      }
    }

    setProfile(null);
    return null;
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
        return { error: new Error('Authentication is not ready yet.'), requiresVerification: false };
      }

      const normalizedEmail = email.trim().toLowerCase();
      const normalizedUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      const normalizedDisplayName = displayName.trim() || normalizedUsername;

      const signUpParams: {
        emailAddress: string;
        password: string;
        username?: string;
        firstName?: string;
        lastName?: string;
      } = {
        emailAddress: normalizedEmail,
        password,
      };

      if (normalizedUsername && supportsSignUpField('username')) {
        signUpParams.username = normalizedUsername;
      }

      const { firstName, lastName } = splitDisplayName(normalizedDisplayName || normalizedUsername);
      if (firstName && supportsSignUpField('first_name')) {
        signUpParams.firstName = firstName;
      }
      if (lastName && supportsSignUpField('last_name')) {
        signUpParams.lastName = lastName;
      }

      const result = await clerkSignUp.password(signUpParams);

      if (result.error) {
        return {
          error: new Error(getAuthErrorMessage(result.error, 'Sign up failed', 'signUp')),
          requiresVerification: false,
        };
      }

      if (clerkSignUp.status !== 'complete') {
        try {
          const sendCodeResult = await clerkSignUp.verifications.sendEmailCode();
          if (sendCodeResult.error) {
            return {
              error: new Error(
                getAuthErrorMessage(
                  sendCodeResult.error,
                  'Sign up started, but verification could not be prepared. Please try again.',
                  'signUp'
                )
              ),
              requiresVerification: false,
            };
          }

          return { error: null, requiresVerification: true };
        } catch (error: unknown) {
          return {
            error: new Error(
              getAuthErrorMessage(
                error,
                'Sign up started, but verification could not be prepared. Please try again.',
                'signUp'
              )
            ),
            requiresVerification: false,
          };
        }
      }

      const finalizeResult = await clerkSignUp.finalize();
      if (finalizeResult.error) {
        return {
          error: new Error(getAuthErrorMessage(finalizeResult.error, 'Sign up finalization failed', 'signUp')),
          requiresVerification: false,
        };
      }

      const ensuredProfile = await ensureProfile(normalizedUsername, normalizedDisplayName);
      if (ensuredProfile.error) {
        const recoveredProfile = await fetchProfile().catch(() => null);
        if (!recoveredProfile) {
          return { error: ensuredProfile.error, requiresVerification: false };
        }
      }

      await fetchProfile().catch(() => undefined);
      return { error: null, requiresVerification: false };
    } catch (error: unknown) {
      return {
        error: new Error(getAuthErrorMessage(error, 'Sign up failed', 'signUp')),
        requiresVerification: false,
      };
    }
  };

  const completeSignUpVerification = async (code: string, username: string, displayName: string) => {
    try {
      if (!clerkSignUp) {
        return { error: new Error('Authentication is not ready yet.') };
      }

      const normalizedCode = code.trim();
      if (!normalizedCode) {
        return { error: new Error('Verification code is required.') };
      }

      const verificationResult = await clerkSignUp.verifications.verifyEmailCode({
        code: normalizedCode,
      });

      if (verificationResult.error) {
        return {
          error: new Error(
            getAuthErrorMessage(verificationResult.error, 'Invalid or expired verification code.', 'signUp')
          ),
        };
      }

      if (clerkSignUp.status !== 'complete') {
        return {
          error: new Error(
            'Verification is not complete yet. Check your code and try again.'
          ),
        };
      }

      const finalizeResult = await clerkSignUp.finalize();
      if (finalizeResult.error) {
        return {
          error: new Error(getAuthErrorMessage(finalizeResult.error, 'Could not finalize sign up.', 'signUp')),
        };
      }

      const ensuredProfile = await ensureProfile(username, displayName);
      if (ensuredProfile.error) {
        const recoveredProfile = await fetchProfile().catch(() => null);
        if (!recoveredProfile) {
          return ensuredProfile;
        }
      }

      await fetchProfile().catch(() => undefined);
      return { error: null };
    } catch (error: unknown) {
      return {
        error: new Error(getAuthErrorMessage(error, 'Could not verify your sign up code.', 'signUp')),
      };
    }
  };

  const resendSignUpVerification = async () => {
    try {
      if (!clerkSignUp) {
        return { error: new Error('Authentication is not ready yet.') };
      }

      const resendResult = await clerkSignUp.verifications.sendEmailCode();
      if (resendResult.error) {
        return {
          error: new Error(getAuthErrorMessage(resendResult.error, 'Could not resend verification code.', 'signUp')),
        };
      }

      return { error: null };
    } catch (error: unknown) {
      return {
        error: new Error(getAuthErrorMessage(error, 'Could not resend verification code.', 'signUp')),
      };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      if (!clerkSignIn) {
        return { error: new Error('Authentication is not ready yet.') };
      }

      const result = await clerkSignIn.password({
        identifier: email.trim().toLowerCase(),
        password,
      });

      if (result.error) {
        return { error: new Error(getAuthErrorMessage(result.error, 'Sign in failed', 'signIn')) };
      }

      if (clerkSignIn.status !== 'complete') {
        return { error: new Error('Sign in requires additional verification in Clerk settings.') };
      }

      const finalizeResult = await clerkSignIn.finalize();
      if (finalizeResult.error) {
        return { error: new Error(getAuthErrorMessage(finalizeResult.error, 'Sign in finalization failed', 'signIn')) };
      }

      await fetchProfile().catch(() => undefined);
      return { error: null };
    } catch (error: unknown) {
      return { error: new Error(getAuthErrorMessage(error, 'Sign in failed', 'signIn')) };
    }
  };

  const signOut = async () => {
    await clerkSignOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        signUp,
        completeSignUpVerification,
        resendSignUpVerification,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
