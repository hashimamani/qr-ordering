import { Navigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { usePlatformAdminAuth } from './PlatformAdminAuthContext';
import { isTokenExpired } from './token';

export function PlatformAdminProtectedRoute({ children }: { children: ReactNode }) {
  const { session, logout } = usePlatformAdminAuth();

  // Same reasoning as the staff ProtectedRoute: an expired token must
  // route to login rather than render a signed-in page that 401s.
  const expired = session !== null && isTokenExpired(session.token);

  useEffect(() => {
    if (expired) logout();
  }, [expired, logout]);

  if (!session || expired) return <Navigate to="/platform-admin/login" replace />;
  return <>{children}</>;
}
