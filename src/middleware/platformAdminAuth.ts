import type { NextFunction, Request, Response } from 'express';
import { verifyPlatformAdminToken, type PlatformAdminTokenPayload } from '../lib/jwt';
import { UnauthorizedError } from '../lib/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformAdmin?: PlatformAdminTokenPayload;
    }
  }
}

/**
 * Gates restaurant onboarding and other platform-level routes. Separate
 * from staff auth entirely -- a platform admin is not scoped to any
 * restaurant_id, so this can never be satisfied by a staff JWT, and a
 * staff JWT's routes can never be satisfied by this. Replaces the earlier
 * shared-secret (`x-platform-admin-key`) gate with a real identity: only
 * accounts that exist in the platform_admin table can onboard tenants.
 */
export function requirePlatformAdminAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  const token = header.slice('Bearer '.length);
  try {
    req.platformAdmin = verifyPlatformAdminToken(token);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
  next();
}
