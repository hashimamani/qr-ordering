import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { StaffRole } from '../api/types';

/**
 * Client-side gate to match what the API already enforces server-side --
 * this is a UX convenience (don't show a kitchen staffer a bar dashboard
 * link), not the actual security boundary. Every request still carries
 * the JWT and the API independently checks restaurant_id + role on every
 * route; a client-side check alone would never be sufficient.
 */
export function ProtectedRoute({ allowedRoles, children }: { allowedRoles: StaffRole[]; children: ReactNode }) {
  const { session } = useAuth();

  if (!session) return <Navigate to="/staff/login" replace />;
  if (!allowedRoles.includes(session.role)) return <Navigate to="/staff/login" replace />;

  return <>{children}</>;
}
