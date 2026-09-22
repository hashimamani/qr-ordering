import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/errors';
import { requireStaffAuth, requireRole } from '../middleware/staffAuth';
import { loginStaff } from '../modules/staff/staff.service';
import { staffLoginSchema } from '../modules/staff/staff.validation';
import { getQueueForDestination, updateOrderItemStatus } from '../modules/orderItems/orderItems.service';
import { getWaiterView, closeSession } from '../modules/tables/tables.service';

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
    const sessions = await getWaiterView(req.staff!.restaurantId);
    res.json({ table_sessions: sessions });
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
    await closeSession(req.staff!.restaurantId, req.params.id);
    res.status(204).send();
  }),
);
