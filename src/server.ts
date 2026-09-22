import 'dotenv/config';
import http from 'http';
import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { logger } from './lib/logger';
import { AppError, ValidationError } from './lib/errors';
import { customerRoutes } from './routes/customerRoutes';
import { staffRoutes } from './routes/staffRoutes';
import { adminRoutes } from './routes/adminRoutes';
import { initRealtime } from './realtime/socketServer';

const app = express();
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

const httpServer = http.createServer(app);
initRealtime(httpServer);

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  logger.info({ port }, 'qr-ordering server listening (http + ws /realtime)');
});

export { app };
