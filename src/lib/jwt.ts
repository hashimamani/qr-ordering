import jwt from 'jsonwebtoken';

export interface StaffTokenPayload {
  sub: string; // staff_user id
  restaurantId: string;
  role: 'admin' | 'waiter' | 'kitchen' | 'bar';
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
