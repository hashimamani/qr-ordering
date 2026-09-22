import path from 'path';
import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { logger } from './lib/logger';
import { AppError, ValidationError } from './lib/errors';
import { customerRoutes } from './routes/customerRoutes';
import { staffRoutes } from './routes/staffRoutes';
import { adminRoutes } from './routes/adminRoutes';

/**
 * Builds the Express app with no process-level side effects (no listen(),
 * no WebSocket server) -- src/server.ts wraps this for local dev,
 * src/lambda.ts wraps it for API Gateway. Keeping construction separate
 * from "how this process is run" is what lets the same route code serve
 * both.
 */
export function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  // Minimal hand-written pages for exercising the API end-to-end in a
  // browser (customer order flow, staff dashboards) -- calls the same
  // JSON API below via fetch/WebSocket, same origin so no CORS setup is
  // needed. Not the production PWA (see README) -- just enough to click
  // through and watch an order move from submission to the kitchen
  // dashboard to "ready".
  //
  // Path differs by environment: locally this file runs from src/, so
  // public/ is one level up. Bundled into the Lambda (esbuild output is a
  // single file with no src/ nesting), infra/lib/api-stack.ts's bundling
  // hook copies public/ to sit right next to the bundle instead.
  const publicDir = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(__dirname, 'public')
    : path.join(__dirname, '..', 'public');
  app.use('/app', express.static(publicDir));

  app.use(customerRoutes);
  app.use(staffRoutes);
  app.use(adminRoutes);

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
