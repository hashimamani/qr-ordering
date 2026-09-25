import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler';
import { ForbiddenError, ValidationError } from '../lib/errors';
import { requireStaffAuth, requireRole } from '../middleware/staffAuth';
import { loginStaff } from '../modules/staff/staff.service';
import { staffLoginSchema, pushSubscribeSchema } from '../modules/staff/staff.validation';
import { getQueueForDestination, updateOrderItemStatus } from '../modules/orderItems/orderItems.service';
import { getWaiterView, closeSession } from '../modules/tables/tables.service';
import { listIdleTablesForRestaurant } from '../modules/tables/tables.repository';
import { upsertPushSubscription } from '../modules/push/push.repository';
import { listMenuForRestaurant } from '../modules/menu/menu.repository';
import { placeStaffOrder, markOrderPaid } from '../modules/orders/orders.service';
import { createOrderSchema } from '../modules/orders/orders.validation';

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

// Tables with no session yet (customer hasn't scanned, or can't) -- a
// waiter starting a staff-assisted order for one of these has nowhere
// else to find it, since it won't appear in /staff/tables until a
// session exists.
staffRoutes.get(
  '/staff/idle-tables',
  requireStaffAuth,
  requireRole('admin', 'waiter'),
  asyncHandler(async (req, res) => {
    const tables = await listIdleTablesForRestaurant(req.staff!.restaurantId);
    res.json({ tables });
  }),
);

staffRoutes.get(
  '/staff/menu',
  requireStaffAuth,
  requireRole('admin', 'waiter'),
  asyncHandler(async (req, res) => {
    const menu = await listMenuForRestaurant(req.staff!.restaurantId);
    res.json(menu);
  }),
);

// Staff-assisted ordering -- for a customer at the table who can't scan
// the QR code themselves. See orders.service.ts's placeStaffOrder for the
// full reasoning (direct-assigns the table to the ordering waiter rather
// than round robin, since they're already standing there).
staffRoutes.post(
  '/staff/tables/:tableId/orders',
  requireStaffAuth,
  requireRole('admin', 'waiter'),
  asyncHandler(async (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid order payload', parsed.error.flatten());
    }
    const result = await placeStaffOrder(req.staff!.restaurantId, req.params.tableId, parsed.data, {
      id: req.staff!.sub,
      role: req.staff!.role,
    });
    res.status(201).json(result);
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

// 'served' is the waiter's own call (they're the one who actually serves
// the table) -- kitchen/bar only ever move an item as far as 'ready'. Kept
// as one route with a status-dependent role check rather than a blanket
// requireRole, since which roles are allowed depends on the target status.
staffRoutes.patch(
  '/staff/order-items/:id/status',
  requireStaffAuth,
  asyncHandler(async (req, res) => {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid status payload', parsed.error.flatten());
    }
    const allowedRoles = parsed.data.status === 'served' ? ['admin', 'waiter'] : ['admin', 'kitchen', 'bar'];
    if (!allowedRoles.includes(req.staff!.role)) {
      throw new ForbiddenError('Your role cannot perform this action');
    }
    await updateOrderItemStatus(req.staff!.restaurantId, req.params.id, parsed.data.status);
    res.status(204).send();
  }),
);

// Manual until real payment integration exists -- an order starts and
// stays 'unpaid' until a waiter marks it, and closeTableSession (see
// tables.repository.ts) refuses to close a table with any unpaid orders.
staffRoutes.patch(
  '/staff/orders/:publicToken/payment-status',
  requireStaffAuth,
  requireRole('admin', 'waiter'),
  asyncHandler(async (req, res) => {
    await markOrderPaid(req.staff!.restaurantId, req.params.publicToken);
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
