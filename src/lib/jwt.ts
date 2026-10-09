import jwt from 'jsonwebtoken';
import type { StaffRole } from '../lib/domain';

export interface StaffTokenPayload {
  sub: string; // staff_user id
  restaurantId: string;
  role: StaffRole;
  /**
   * Set only on a platform admin's look-but-don't-touch token. Enforced
   * in requireStaffAuth by rejecting every method except GET/HEAD, so a
   * route added later is covered without anyone remembering to.
   */
  readOnly?: true;
  /**
   * Who is really behind a read-only token. The platform_admin id, kept
   * so the logs can say which person looked at a tenant's data rather
   * than just that "someone" did.
   */
  viewerPlatformAdminId?: string;
}

function requireSecret(envVar: string): string {
  const secret = process.env[envVar];
  if (!secret) {
    throw new Error(`${envVar} is not set`);
  }
  return secret;
}

export function signStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, requireSecret('JWT_SECRET'), { expiresIn: '12h' });
}

/**
 * A platform admin's read-only view of one restaurant.
 *
 * Deliberately short-lived. The restaurant must be in test mode to get
 * one, and mode is checked when the token is minted rather than on every
 * request; a 30-minute life bounds how long a token outlives the
 * condition that justified it.
 */
export function signReadOnlyStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, requireSecret('JWT_SECRET'), { expiresIn: '30m' });
}

export function verifyStaffToken(token: string): StaffTokenPayload {
  return jwt.verify(token, requireSecret('JWT_SECRET')) as StaffTokenPayload;
}

// Signed with a separate secret from the staff JWT (not just a different
// claim shape) so a leaked staff secret can never be used to forge a
// platform-admin token, which is scoped to no restaurant at all.
export interface PlatformAdminTokenPayload {
  sub: string; // platform_admin id
  type: 'platform_admin';
}

export function signPlatformAdminToken(payload: PlatformAdminTokenPayload): string {
  return jwt.sign(payload, requireSecret('PLATFORM_ADMIN_JWT_SECRET'), { expiresIn: '12h' });
}

export function verifyPlatformAdminToken(token: string): PlatformAdminTokenPayload {
  return jwt.verify(token, requireSecret('PLATFORM_ADMIN_JWT_SECRET')) as PlatformAdminTokenPayload;
}
