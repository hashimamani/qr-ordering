import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StaffRole } from '../api/types';
import { isTokenExpired } from './token';
import { onUnauthorized } from '../api/client';

export interface StaffSession {
  token: string;
  /**
   * A platform admin looking at a restaurant they do not work for. The
   * server refuses every write from such a token; the UI hides the
   * controls so nobody discovers that by being refused.
   */
  readOnly: boolean;
  restaurantId: string;
  staffId: string;
  role: StaffRole;
  name: string;
  restaurantName: string;
  brandColor: string | null;
}

interface AuthContextValue {
  session: StaffSession | null;
  login: (token: string, name: string, restaurantName: string, brandColor: string | null) => void;
  /**
   * Updates the restaurant identity on the live session without a
   * re-login, so the Branding form's save takes effect immediately in the
   * tab that made the change.
   */
  updateBranding: (restaurantName: string, brandColor: string | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface StoredIdentity {
  name: string;
  restaurantName: string;
  brandColor: string | null;
}

function clearStoredSession(): void {
  sessionStorage.removeItem('staffToken');
  sessionStorage.removeItem('staffName');
  sessionStorage.removeItem('restaurantName');
  sessionStorage.removeItem('brandColor');
}

function decodeSession(token: string, identity: StoredIdentity): StaffSession | null {
  // An expired token used to decode into a perfectly valid-looking
  // session: ProtectedRoute let the user through, and then every request
  // on the page 401'd into an error banner. Treating it as no session at
  // all is what sends them to the login page instead.
  if (isTokenExpired(token)) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      token,
      restaurantId: payload.restaurantId,
      staffId: payload.sub,
      role: payload.role,
      readOnly: payload.readOnly === true,
      ...identity,
    };
  } catch {
    return null;
  }
}

// Restaurant name/colour live in sessionStorage alongside the token rather
// than in the JWT: the token is signed, so anything baked into it goes
// stale the moment an admin edits it and can't be refreshed without
// forcing a re-login. Known limitation of storing it per-session: a colour
// changed in one tab doesn't reach other already-open sessions until their
// next login. updateBranding covers the tab that made the change.
//
// sessionStorage, not localStorage -- deliberately scoped to this one tab.
// localStorage is shared across every tab on the origin, so logging into a
// second role (e.g. admin) in another tab would silently overwrite the
// token a first tab's already-open waiter session reads on its next
// request, making that tab start acting (and seeing data) as the new
// role under the old one's UI chrome.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StaffSession | null>(() => {
    const token = sessionStorage.getItem('staffToken');
    if (!token) return null;
    // Cleared here, in the initializer, rather than in an effect: an
    // effect runs after the first render, leaving a window in which a
    // child's own effect could fire a request carrying the dead token.
    if (isTokenExpired(token)) {
      clearStoredSession();
      return null;
    }
    return decodeSession(token, {
      name: sessionStorage.getItem('staffName') ?? '',
      restaurantName: sessionStorage.getItem('restaurantName') ?? '',
      brandColor: sessionStorage.getItem('brandColor'),
    });
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: (token, name, restaurantName, brandColor) => {
        sessionStorage.setItem('staffToken', token);
        sessionStorage.setItem('staffName', name);
        sessionStorage.setItem('restaurantName', restaurantName);
        if (brandColor) sessionStorage.setItem('brandColor', brandColor);
        else sessionStorage.removeItem('brandColor');
        setSession(decodeSession(token, { name, restaurantName, brandColor }));
      },
      updateBranding: (restaurantName, brandColor) => {
        sessionStorage.setItem('restaurantName', restaurantName);
        if (brandColor) sessionStorage.setItem('brandColor', brandColor);
        else sessionStorage.removeItem('brandColor');
        setSession((prev) => (prev ? { ...prev, restaurantName, brandColor } : prev));
      },
      logout: () => {
        clearStoredSession();
        setSession(null);
      },
    }),
    [session],
  );

  // A session can also die mid-visit: the token was valid when the page
  // loaded and the server rejected it later. Clearing on the 401 means
  // ProtectedRoute redirects on the next render rather than the page
  // filling with failures. Scoped by token so a platform-admin 401 in
  // the same tab does not log a staff user out.
  useEffect(
    () =>
      onUnauthorized((failedToken) => {
        if (failedToken === sessionStorage.getItem('staffToken')) {
          clearStoredSession();
          setSession(null);
        }
      }),
    [],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
