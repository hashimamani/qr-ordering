import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { fixedWindowRateLimit } from '../lib/rateLimit';
import { ValidationError } from '../lib/errors';
import { resolveTableForOrdering } from '../modules/tables/tables.service';
import { placeOrder } from '../modules/orders/orders.service';
import { createOrderSchema } from '../modules/orders/orders.validation';
import { findOrderByPublicToken } from '../modules/tracking/tracking.repository';

export const customerRoutes = Router();

customerRoutes.get(
  '/r/:slug/t/:qrToken',
  asyncHandler(async (req, res) => {
    const { slug, qrToken } = req.params;
    const result = await resolveTableForOrdering(slug, qrToken);
    res.json(result);
  }),
);

customerRoutes.post(
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

customerRoutes.get(
  '/track/:publicToken',
  fixedWindowRateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const order = await findOrderByPublicToken(req.params.publicToken);
    res.json(order);
  }),
);
