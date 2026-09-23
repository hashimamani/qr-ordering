import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { logger } from './lib/logger';
import { AppError, ValidationError } from './lib/errors';
import { customerRoutes } from './routes/customerRoutes';
import { staffRoutes } from './routes/staffRoutes';
import { adminRoutes } from './routes/adminRoutes';
import { platformAdminRoutes } from './routes/platformAdminRoutes';

/**
 * Builds the Express app with no process-level side effects (no listen(),
 * no WebSocket server) -- src/server.ts wraps this for local dev,
 * src/lambda.ts wraps it for API Gateway. Keeping construction separate
 * from "how this process is run" is what lets the same route code serve
 * both.
 */
export function buildApp() {
  const app = express();

  // The frontend (React/Vite, S3+CloudFront in production) is a genuinely
  // different origin now -- API Gateway's own corsPreflight config
  // (api-stack.ts) adds Access-Control-* headers to every response in
  // production, including ones from this app, so header-setting stays
  // local-dev-only (Vite and this server run on different ports there,
  // with no API Gateway in front to add them).
  //
  // The OPTIONS short-circuit below runs in BOTH environments, though --
  // this app is wired to API Gateway via one catch-all `defaultIntegration`
  // (see api-stack.ts), which forwards every method to this Lambda,
  // OPTIONS included, instead of letting API Gateway auto-answer
  // preflight the way corsPreflight normally implies. Without this, an
  // OPTIONS request for e.g. POST /admin/menu-items falls through to
  // adminRoutes' auth-gating middleware (no bearer token on a preflight
  // request) and comes back 401 -- CORS-valid headers on a non-2xx status
  // still fail the browser's preflight check, breaking every cross-origin
  // POST/PATCH/DELETE and every request carrying Authorization, discovered
  // live testing the platform-admin login flow.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(customerRoutes);
  app.use(staffRoutes);
  app.use(adminRoutes);
  app.use(platformAdminRoutes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'validation_error', message: 'Invalid request', details: err.flatten() } });
      return;
    }
    if (err instanceof AppError) {
      const body: Record<string, unknown> = { code: err.code, message: err.message };
      if (err instanceof ValidationError && err.details) {
        body.details = err.details;
      }
      req.log.warn({ err }, 'request failed');
      res.status(err.statusCode).json({ error: body });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });

  return app;
}
