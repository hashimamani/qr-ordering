import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireStaffAuth } from './staffAuth';
import { signStaffToken, signReadOnlyStaffToken } from '../lib/jwt';
import { ForbiddenError } from '../lib/errors';

/**
 * The read-only guard is the whole security story for a platform admin
 * viewing someone else's restaurant, and it lives in one place on
 * purpose: a per-route deny-list would be one forgotten entry away from
 * letting an outsider write to a tenant's data. These assert the choke
 * point holds for every mutating verb, including ones no route uses
 * today, because the point is that future routes are covered too.
 */
process.env.JWT_SECRET = 'test-secret-for-staff-auth';

function reqWith(token: string, method: string): Request {
  return {
    method,
    header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined),
  } as unknown as Request;
}

const PAYLOAD = { sub: 's1', restaurantId: 'r1', role: 'admin' as const };
const READ_ONLY = { ...PAYLOAD, sub: 'platform-admin:p1', readOnly: true as const, viewerPlatformAdminId: 'p1' };

function run(token: string, method: string) {
  const next = vi.fn();
  requireStaffAuth(reqWith(token, method), {} as Response, next);
  return next;
}

describe('a read-only platform-admin token', () => {
  it('may read', () => {
    for (const method of ['GET', 'HEAD']) {
      expect(() => run(signReadOnlyStaffToken(READ_ONLY), method)).not.toThrow();
    }
  });

  it('may not write, by any verb', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(() => run(signReadOnlyStaffToken(READ_ONLY), method)).toThrow(ForbiddenError);
    }
  });

  it('is refused before role is even considered', () => {
    // role is 'admin', which would otherwise pass every gate -- readOnly
    // has to win regardless.
    expect(() => run(signReadOnlyStaffToken(READ_ONLY), 'DELETE')).toThrow(/read-only/i);
  });
});

describe('an ordinary staff token', () => {
  it('is unaffected and may still write', () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect(() => run(signStaffToken(PAYLOAD), method)).not.toThrow();
    }
  });
});
