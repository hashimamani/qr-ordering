import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { usePlatformAdminAuth } from './PlatformAdminAuthContext';

export function PlatformAdminProtectedRoute({ children }: { children: ReactNode }) {
  const { session } = usePlatformAdminAuth();
  if (!session) return <Navigate to="/platform-admin/login" replace />;
  return <>{children}</>;
}
