import type { NextFunction, Request, Response } from 'express';

/**
 * Minimal in-memory fixed-window limiter for local/staging use. In
 * production this endpoint sits behind API Gateway usage-plan throttling
 * (see build notes); this is only a same-process stand-in so the endpoint
 * isn't wide open during local development.
 */
export function fixedWindowRateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    if (entry.count >= opts.max) {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests' } });
      return;
    }

    entry.count += 1;
    next();
  };
}
