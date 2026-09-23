import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface PlatformAdminSession {
  token: string;
  name: string;
}

interface PlatformAdminAuthContextValue {
  session: PlatformAdminSession | null;
  login: (token: string, name: string) => void;
  logout: () => void;
}

const PlatformAdminAuthContext = createContext<PlatformAdminAuthContextValue | null>(null);

// Deliberately separate from AuthContext (the staff/restaurant-admin
// session) rather than generalized into it -- different localStorage
// keys, different token audience, and a platform admin is never scoped
// to a restaurant_id the way a StaffSession always is.
export function PlatformAdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlatformAdminSession | null>(() => {
    const token = localStorage.getItem('platformAdminToken');
    const name = localStorage.getItem('platformAdminName') ?? '';
    return token ? { token, name } : null;
  });

  const value = useMemo<PlatformAdminAuthContextValue>(
    () => ({
      session,
      login: (token: string, name: string) => {
        localStorage.setItem('platformAdminToken', token);
        localStorage.setItem('platformAdminName', name);
        setSession({ token, name });
      },
      logout: () => {
        localStorage.removeItem('platformAdminToken');
        localStorage.removeItem('platformAdminName');
        setSession(null);
      },
    }),
    [session],
  );

  return <PlatformAdminAuthContext.Provider value={value}>{children}</PlatformAdminAuthContext.Provider>;
}

export function usePlatformAdminAuth(): PlatformAdminAuthContextValue {
  const ctx = useContext(PlatformAdminAuthContext);
  if (!ctx) throw new Error('usePlatformAdminAuth must be used within PlatformAdminAuthProvider');
  return ctx;
}
