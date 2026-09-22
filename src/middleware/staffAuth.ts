import type { NextFunction, Request, Response } from 'express';
import { verifyStaffToken, type StaffTokenPayload } from '../lib/jwt';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffTokenPayload;
    }
  }
}

/**
 * Extracts and verifies the staff JWT, attaching req.staff. Every
 * staff/admin route reads restaurant_id from req.staff — never from the
 * request body or URL — so authorization cannot be bypassed by passing a
 * different restaurant_id on the wire.
 */
export function requireStaffAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  const token = header.slice('Bearer '.length);
  try {
    req.staff = verifyStaffToken(token);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
  next();
}

export function requireRole(...roles: StaffTokenPayload['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.staff || !roles.includes(req.staff.role)) {
      throw new ForbiddenError('Your role cannot perform this action');
    }
    next();
  };
}
