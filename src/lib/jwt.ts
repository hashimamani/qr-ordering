import jwt from 'jsonwebtoken';

export interface StaffTokenPayload {
  sub: string; // staff_user id
  restaurantId: string;
  role: 'admin' | 'waiter' | 'kitchen' | 'bar';
}

const secret = process.env.JWT_SECRET;

function requireSecret(): string {
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

export function signStaffToken(payload: StaffTokenPayload): string {
  return jwt.sign(payload, requireSecret(), { expiresIn: '12h' });
}

export function verifyStaffToken(token: string): StaffTokenPayload {
  return jwt.verify(token, requireSecret()) as StaffTokenPayload;
}
