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
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

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
    const tokens = await apiPost<TokenPair>('/auth/login', { email, password });
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

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
