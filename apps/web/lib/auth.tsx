'use client';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type TokenPair, apiFetch, apiPost, clearTokens, getTokens, setTokens } from './api';

export interface CurrentUser {
  userId: string;
  tenantId: string;
  roles: string[];
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  /** Returns a 2FA ticket when the account requires a second factor; otherwise signs in. */
  login: (email: string, password: string) => Promise<{ twoFactorRequired: boolean; ticket?: string }>;
  /** Complete a 2FA login with the challenge ticket + a TOTP/recovery code. */
  completeTwoFactor: (ticket: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

type LoginResult = TokenPair | { twoFactorRequired: true; ticket: string };

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!getTokens()) {
      setLoading(false);
      return;
    }
    apiFetch<CurrentUser>('/me')
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiPost<LoginResult>('/auth/login', { email, password });
    if ('twoFactorRequired' in res) return { twoFactorRequired: true, ticket: res.ticket };
    setTokens(res);
    setUser(await apiFetch<CurrentUser>('/me'));
    return { twoFactorRequired: false };
  };

  const completeTwoFactor = async (ticket: string, code: string) => {
    const tokens = await apiPost<TokenPair>('/auth/2fa/verify', { ticket, code });
    setTokens(tokens);
    setUser(await apiFetch<CurrentUser>('/me'));
  };

  const logout = async () => {
    const tokens = getTokens();
    if (tokens) await apiPost('/auth/logout', { refreshToken: tokens.refreshToken }).catch(() => undefined);
    clearTokens();
    setUser(null);
    router.push('/login');
  };

  return <AuthContext.Provider value={{ user, loading, login, completeTwoFactor, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
