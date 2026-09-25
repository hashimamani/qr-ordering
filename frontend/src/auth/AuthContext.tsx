import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { StaffRole } from '../api/types';

export interface StaffSession {
  token: string;
  restaurantId: string;
  staffId: string;
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
    return { token, restaurantId: payload.restaurantId, staffId: payload.sub, role: payload.role, name };
  } catch {
    return null;
  }
}

// sessionStorage, not localStorage -- deliberately scoped to this one tab.
// localStorage is shared across every tab on the origin, so logging into a
// second role (e.g. admin) in another tab would silently overwrite the
// token a first tab's already-open waiter session reads on its next
// request, making that tab start acting (and seeing data) as the new
// role under the old one's UI chrome.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(() => {
    const token = sessionStorage.getItem('staffToken');
    const name = sessionStorage.getItem('staffName') ?? '';
    return token ? decodeSession(token, name) : null;
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: (token: string, name: string) => {
        sessionStorage.setItem('staffToken', token);
        sessionStorage.setItem('staffName', name);
        setSession(decodeSession(token, name));
      },
      logout: () => {
        sessionStorage.removeItem('staffToken');
        sessionStorage.removeItem('staffName');
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
