import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/errors';
import { requireStaffAuth, requireRole } from '../middleware/staffAuth';
import { loginStaff } from '../modules/staff/staff.service';
import { staffLoginSchema, pushSubscribeSchema } from '../modules/staff/staff.validation';
import { getQueueForDestination, updateOrderItemStatus } from '../modules/orderItems/orderItems.service';
import { getWaiterView, closeSession } from '../modules/tables/tables.service';
import { upsertPushSubscription } from '../modules/push/push.repository';

export const staffRoutes = Router();

staffRoutes.post(
  '/staff/login',
  asyncHandler(async (req, res) => {
    const parsed = staffLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid login payload', parsed.error.flatten());
    }
    const result = await loginStaff(
      parsed.data.restaurant_slug,
      parsed.data.phone_or_email,
      parsed.data.password,
    );
    res.json(result);
  }),
);

staffRoutes.get(
  '/staff/kitchen',
  requireStaffAuth,
  requireRole('admin', 'kitchen'),
  asyncHandler(async (req, res) => {
    const queue = await getQueueForDestination(req.staff!.restaurantId, 'kitchen');
    res.json({ tables: queue });
  }),
);

staffRoutes.get(
  '/staff/bar',
  requireStaffAuth,
  requireRole('admin', 'bar'),
  asyncHandler(async (req, res) => {
    const queue = await getQueueForDestination(req.staff!.restaurantId, 'bar');
    res.json({ tables: queue });
  }),
);

staffRoutes.get(
  '/staff/tables',
  requireStaffAuth,
  requireRole('admin', 'waiter'),
  asyncHandler(async (req, res) => {
    const sessions = await getWaiterView(req.staff!.restaurantId, req.staff!.role, req.staff!.sub);
    res.json({ table_sessions: sessions });
  }),
);

staffRoutes.get(
  '/staff/push/vapid-public-key',
  requireStaffAuth,
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? '' });
  }),
);

staffRoutes.post(
  '/staff/push/subscribe',
  requireStaffAuth,
  requireRole('admin', 'waiter'),
  asyncHandler(async (req, res) => {
    const parsed = pushSubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid push subscription payload', parsed.error.flatten());
    }
    await upsertPushSubscription(req.staff!.sub, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    });
    res.status(204).send();
  }),
);

const updateStatusSchema = z.object({
  status: z.enum(['preparing', 'ready', 'served']),
});

staffRoutes.patch(
  '/staff/order-items/:id/status',
  requireStaffAuth,
  requireRole('admin', 'kitchen', 'bar'),
  asyncHandler(async (req, res) => {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid status payload', parsed.error.flatten());
    }
    await updateOrderItemStatus(req.staff!.restaurantId, req.params.id, parsed.data.status);
    res.status(204).send();
  }),
);

staffRoutes.patch(
  '/staff/table-sessions/:id/close',
  requireStaffAuth,
  requireRole('admin', 'waiter'),
  asyncHandler(async (req, res) => {
    await closeSession(req.staff!.restaurantId, req.params.id, { id: req.staff!.sub, role: req.staff!.role });
    res.status(204).send();
  }),
);
