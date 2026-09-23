import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { StaffRole } from '../api/types';

export interface StaffSession {
  token: string;
  restaurantId: string;
  role: StaffRole;
  name: string;
}

interface AuthContextValue {
  session: StaffSession | null;
  login: (token: string, name: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeSession(token: string, name: string): StaffSession | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { token, restaurantId: payload.restaurantId, role: payload.role, name };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(() => {
    const token = localStorage.getItem('staffToken');
    const name = localStorage.getItem('staffName') ?? '';
    return token ? decodeSession(token, name) : null;
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: (token: string, name: string) => {
        localStorage.setItem('staffToken', token);
        localStorage.setItem('staffName', name);
        setSession(decodeSession(token, name));
      },
      logout: () => {
        localStorage.removeItem('staffToken');
        localStorage.removeItem('staffName');
        setSession(null);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
