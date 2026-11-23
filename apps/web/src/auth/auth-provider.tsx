'use client';

import type { AuthUser } from '@healthvault/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authRequest } from './api';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
  refreshUser: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const result = await authRequest<{ user: AuthUser }>('/me');
      setUser(result.user);
      return result.user;
    } catch {
      try {
        await authRequest('/refresh', { method: 'POST', body: '{}' });
        const result = await authRequest<{ user: AuthUser }>('/me');
        setUser(result.user);
        return result.user;
      } catch {
        setUser(null);
        return null;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authRequest('/logout', { method: 'POST', body: '{}' });
    } finally {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const value = useMemo(
    () => ({ user, loading, setUser, refreshUser, logout }),
    [user, loading, refreshUser, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
