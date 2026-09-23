import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { fixedWindowRateLimit } from '../lib/rateLimit';
import { ValidationError } from '../lib/errors';
import { resolveTableForOrdering } from '../modules/tables/tables.service';
import { placeOrder } from '../modules/orders/orders.service';
import { createOrderSchema } from '../modules/orders/orders.validation';
import { findOrderByPublicToken } from '../modules/tracking/tracking.repository';
import { findTableContextByPublicToken, assignNextWaiterRoundRobin } from '../modules/tables/tables.repository';
import { broadcastToTableWaiter } from '../realtime/waiterBroadcast';
import { sendPushToStaff } from '../realtime/webPush';

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

customerRoutes.post(
  '/track/:publicToken/call-waiter',
  fixedWindowRateLimit({ windowMs: 60_000, max: 3 }),
  asyncHandler(async (req, res) => {
    const context = await findTableContextByPublicToken(req.params.publicToken);
    // A call-waiter press claims a still-unassigned table too, same as a
    // first order -- either can be the moment a table gets a waiter.
    let assignedWaiterId = context.assigned_waiter_id;
    if (!assignedWaiterId) {
      assignedWaiterId = await assignNextWaiterRoundRobin(context.restaurant_id, context.table_id);
    }
    await broadcastToTableWaiter(context.restaurant_id, context.table_id, {
      type: 'call_waiter',
      table_number: context.table_number,
    });
    if (assignedWaiterId) {
      await sendPushToStaff(assignedWaiterId, {
        title: `Table ${context.table_number}`,
        body: 'Needs you',
      });
    }
    res.status(204).send();
  }),
);
