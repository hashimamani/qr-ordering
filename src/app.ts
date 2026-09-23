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

  // The frontend (React/Vite, S3+CloudFront in production) is a genuinely
  // different origin now -- API Gateway's own corsPreflight config
  // (api-stack.ts) handles this for the deployed Lambda, adding headers
  // to every response automatically. That doesn't apply when running
  // this Express app directly (`npm run dev`), so local dev needs its
  // own CORS handling -- the Vite dev server and this server run on
  // different ports.
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  app.use(express.json());
  app.use(pinoHttp({ logger }));

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
