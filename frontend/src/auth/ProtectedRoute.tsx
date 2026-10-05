import { Navigate } from 'react-router-dom';
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

  if (!session || expired) return <Navigate to="/staff/login" replace />;
  if (!allowedRoles.includes(session.role)) return <Navigate to="/staff/login" replace />;

  return <>{children}</>;
}
