import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { logger } from './lib/logger';
import { AppError, ValidationError } from './lib/errors';
import { fixedWindowRateLimit } from './lib/rateLimit';
import { resolveTableForOrdering } from './modules/tables/tables.service';
import { placeOrder } from './modules/orders/orders.service';
import { createOrderSchema } from './modules/orders/orders.validation';
import { findOrderByPublicToken } from './modules/tracking/tracking.repository';

const app = express();
app.use(express.json());
app.use(pinoHttp({ logger }));

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

app.get(
  '/r/:slug/t/:qrToken',
  asyncHandler(async (req, res) => {
    const { slug, qrToken } = req.params;
    const result = await resolveTableForOrdering(slug, qrToken);
    res.json(result);
  }),
);

app.post(
  '/r/:slug/t/:qrToken/orders',
  asyncHandler(async (req, res) => {
    const { slug, qrToken } = req.params;
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid order payload', parsed.error.flatten());
    }
    const result = await placeOrder(slug, qrToken, parsed.data);
    res.status(201).json(result);
  }),
);

app.get(
  '/track/:publicToken',
  fixedWindowRateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const order = await findOrderByPublicToken(req.params.publicToken);
    res.json(order);
  }),
);

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

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  logger.info({ port }, 'qr-ordering server listening');
});

export { app };
