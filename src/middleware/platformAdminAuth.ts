import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../lib/errors';

/**
 * Gates restaurant-signup/bootstrap: creating a brand-new tenant can't be
 * gated by a staff JWT (no restaurant/admin exists yet to issue one from),
 * so it's gated by a shared platform-operator secret instead. This is a
 * deliberate addition beyond the original API spec, needed to make
 * onboarding actually reachable end-to-end -- flagged here and in the
 * README rather than added silently.
 */
export function requirePlatformAdminKey(req: Request, _res: Response, next: NextFunction): void {
  const expected = process.env.PLATFORM_ADMIN_KEY;
  if (!expected) {
    throw new Error('PLATFORM_ADMIN_KEY is not set');
  }
  if (req.header('x-platform-admin-key') !== expected) {
    throw new UnauthorizedError('Invalid platform admin key');
  }
  next();
}
