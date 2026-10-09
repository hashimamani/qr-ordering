import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

/**
 * Hides controls a platform admin's read-only session cannot use.
 *
 * The server is the authority -- requireStaffAuth refuses every non-GET
 * from a read-only token -- so this is purely so the viewer does not
 * discover that by filling in a form and being refused. Nothing here is
 * a security boundary, and it must never be treated as one.
 *
 * Deliberately not a blanket disable of the admin shell: filtering a
 * 273-item menu and paging reports are reads, and a viewer inspecting a
 * restaurant needs them.
 */
export function ReadOnlyGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  if (session?.readOnly) return null;
  return <>{children}</>;
}

/** For disabling a single control rather than removing a whole block. */
export function useIsReadOnly(): boolean {
  const { session } = useAuth();
  return session?.readOnly === true;
}
