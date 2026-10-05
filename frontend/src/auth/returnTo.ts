import type { StaffRole } from '../api/types';

/** Where each role lands when there is nowhere better to send them. */
export const ROLE_DESTINATION: Record<StaffRole, string> = {
  admin: '/admin',
  kitchen: '/staff/kitchen',
  bar: '/staff/bar',
  waiter: '/staff/waiter',
};

/**
 * Mirrors the allowedRoles on the routes in App.tsx. Kept as prefixes so
 * nested paths (/admin/overview, /admin/kitchen, ...) resolve to their
 * parent's rule rather than needing an entry each.
 *
 * Longest prefix first: /staff/kitchen must be tested before /staff, or
 * a shorter entry would swallow the specific ones.
 */
const ROUTE_ROLES: ReadonlyArray<{ prefix: string; roles: readonly StaffRole[] }> = [
  { prefix: '/staff/kitchen', roles: ['admin', 'kitchen'] },
  { prefix: '/staff/bar', roles: ['admin', 'bar'] },
  { prefix: '/staff/waiter', roles: ['admin', 'waiter'] },
  { prefix: '/admin', roles: ['admin'] },
];

/**
 * Only in-app absolute paths are ever restored. The value travels in
 * router state rather than the URL, so it is not attacker-supplied
 * today, but validating here means that stays true if it is ever moved
 * to a query parameter -- "//evil.example" and "https://evil.example"
 * are both rejected rather than becoming an open redirect.
 */
function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

/**
 * Where to go after a successful staff login.
 *
 * A remembered destination is honoured only when the role that just
 * logged in is actually allowed there. The session that expired is not
 * necessarily the session being created: a bar user logging in on a
 * machine where a kitchen session lapsed must land on the bar
 * dashboard, not be bounced straight back out by ProtectedRoute.
 */
export function destinationAfterLogin(role: StaffRole, attempted?: string | null): string {
  const fallback = ROLE_DESTINATION[role];
  if (!attempted || !isInternalPath(attempted)) return fallback;

  // Returning to a login page would be a loop.
  if (attempted.startsWith('/staff/login') || attempted.startsWith('/platform-admin/login')) {
    return fallback;
  }

  const rule = ROUTE_ROLES.find(
    (r) => attempted === r.prefix || attempted.startsWith(`${r.prefix}/`) || attempted.startsWith(`${r.prefix}?`),
  );
  if (!rule) return fallback;
  return rule.roles.includes(role) ? attempted : fallback;
}

/**
 * The platform-admin equivalent. One destination, so there is no role to
 * match -- only the loop guard and the internal-path check, plus a check
 * that the path is actually inside the platform-admin area so a stale
 * staff path can never be restored here.
 */
export function platformAdminDestination(attempted?: string | null): string {
  const fallback = '/platform-admin';
  if (!attempted || !isInternalPath(attempted)) return fallback;
  if (attempted.startsWith('/platform-admin/login')) return fallback;
  return attempted === '/platform-admin' || attempted.startsWith('/platform-admin/')
    ? attempted
    : fallback;
}
