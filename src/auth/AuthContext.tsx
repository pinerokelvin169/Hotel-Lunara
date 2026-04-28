import { createContext, useMemo, useState } from 'react';
import { login as apiLogin, setAuthToken } from '../app/api';
import type { AuthUser, LoginPayload } from '../app/types';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: AuthUser['roles']) => boolean;
}

const STORAGE_KEY = 'hotel-backoffice-auth';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AuthUser;
      setAuthToken(parsed.accessToken);
      return parsed;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  });

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user?.accessToken,
    async login(payload) {
      const authUser = await apiLogin(payload);
      setUser(authUser);
      setAuthToken(authUser.accessToken);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    },
    logout() {
      setUser(null);
      setAuthToken(null);
      localStorage.removeItem(STORAGE_KEY);
    },
    hasRole(...roles) {
      if (!user) {
        return false;
      }

      return roles.some((role) => user.roles.includes(role));
    },
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
