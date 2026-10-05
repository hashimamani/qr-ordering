import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { isTokenExpired } from './token';
import type { StaffRole } from '../api/types';

/**
 * Client-side gate to match what the API already enforces server-side --
 * this is a UX convenience (don't show a kitchen staffer a bar dashboard
 * link), not the actual security boundary. Every request still carries
 * the JWT and the API independently checks restaurant_id + role on every
 * route; a client-side check alone would never be sufficient.
 */
export function ProtectedRoute({ allowedRoles, children }: { allowedRoles: StaffRole[]; children: ReactNode }) {
  const { session, logout } = useAuth();
  const location = useLocation();

  // Carried in router state rather than the URL: it keeps the login page
  // clean and keeps the value out of anywhere an attacker could set it.
  // Lost on a hard refresh of the login page, which just falls back to
  // the role's default -- an acceptable trade for not putting a redirect
  // target in a query string.
  const from = `${location.pathname}${location.search}`;

  // Checked on every navigation, not just at load: a token valid when the
  // app opened can lapse while a dashboard sits on screen overnight, and
  // without this the next route change renders a signed-in page whose
  // every request then 401s.
  const expired = session !== null && isTokenExpired(session.token);

  // Clearing happens in an effect rather than during render -- setting
  // state mid-render is what produces React's "cannot update while
  // rendering" warning. The redirect below does not wait for it.
  useEffect(() => {
    if (expired) logout();
  }, [expired, logout]);

  if (!session || expired) return <Navigate to="/staff/login" state={{ from }} replace />;
  // Deliberately no `from` here: this is a role mismatch, not a lapsed
  // session, so sending them back to a page their role cannot open would
  // just bounce them out again.
  if (!allowedRoles.includes(session.role)) return <Navigate to="/staff/login" replace />;

  return <>{children}</>;
}
