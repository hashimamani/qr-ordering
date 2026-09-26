import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/errors';
import { requireStaffAuth, requireRole } from '../middleware/staffAuth';
import {
  createMenuCategorySchema,
  updateMenuCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  createTableSchema,
  assignWaiterSchema,
} from '../modules/admin/admin.validation';
import { createStaffUserSchema, updateStaffUserSchema } from '../modules/staff/staff.validation';
import {
  createMenuItemForRestaurant,
  createTableWithQrCode,
  createStaffUserForRestaurant,
  updateStaffUserForRestaurant,
  regenerateQrCodeForTable,
} from '../modules/admin/admin.service';
import {
  insertMenuCategory,
  updateMenuCategoryById,
  deleteMenuCategoryById,
  updateMenuItemById,
  deleteMenuItemById,
  listTablesForRestaurant,
  assignWaiterToTable,
  removeTable,
} from '../modules/admin/admin.repository';
import { listMenuForRestaurantAdmin } from '../modules/menu/menu.repository';
import { listStaffUsersForRestaurant, deleteStaffUser } from '../modules/staff/staff.repository';
import { findRestaurantById } from '../modules/tables/tables.repository';
import { ForbiddenError } from '../lib/errors';
import { dateRangeSchema, breakdownQuerySchema, exportQuerySchema } from '../modules/reports/reports.validation';
import { getTodaySummary, getSummary, getBreakdown, renderExport } from '../modules/reports/reports.service';

export const adminRoutes = Router();

// Restaurant onboarding lives at /platform-admin/restaurants now (see
// src/routes/platformAdminRoutes.ts) -- gated by a real platform_admin
// login instead of a shared secret. Everything below here is scoped to
// an existing restaurant's own admin.
//
// Scoped to the '/admin' prefix explicitly -- a bare `.use(mw)` with no
// path runs for every request that reaches this router at all (it's
// mounted at app root), which would 401 requests meant for other
// routers (e.g. /platform-admin/*) that happen to be mounted after this
// one, not just this router's own /admin/* routes.
adminRoutes.use('/admin', requireStaffAuth, requireRole('admin'));

adminRoutes.get(
  '/admin/menu',
  asyncHandler(async (req, res) => {
    const menu = await listMenuForRestaurantAdmin(req.staff!.restaurantId);
    res.json(menu);
  }),
);

adminRoutes.post(
  '/admin/menu-categories',
  asyncHandler(async (req, res) => {
    const parsed = createMenuCategorySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid category payload', parsed.error.flatten());
    const category = await insertMenuCategory(req.staff!.restaurantId, {
      name: parsed.data.name,
      sortOrder: parsed.data.sort_order,
    });
    res.status(201).json(category);
  }),
);

adminRoutes.patch(
  '/admin/menu-categories/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateMenuCategorySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid category payload', parsed.error.flatten());
    const category = await updateMenuCategoryById(req.staff!.restaurantId, req.params.id, {
      name: parsed.data.name,
      sortOrder: parsed.data.sort_order,
    });
    res.json(category);
  }),
);

adminRoutes.delete(
  '/admin/menu-categories/:id',
  asyncHandler(async (req, res) => {
    await deleteMenuCategoryById(req.staff!.restaurantId, req.params.id);
    res.status(204).send();
  }),
);

adminRoutes.post(
  '/admin/menu-items',
  asyncHandler(async (req, res) => {
    const parsed = createMenuItemSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid menu item payload', parsed.error.flatten());
    const item = await createMenuItemForRestaurant(req.staff!.restaurantId, parsed.data);
    res.status(201).json(item);
  }),
);

adminRoutes.patch(
  '/admin/menu-items/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateMenuItemSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid menu item payload', parsed.error.flatten());
    const item = await updateMenuItemById(req.staff!.restaurantId, req.params.id, {
      categoryId: parsed.data.category_id,
      name: parsed.data.name,
      description: parsed.data.description,
      price: parsed.data.price,
      destination: parsed.data.destination,
      isAvailable: parsed.data.is_available,
    });
    res.json(item);
  }),
);

adminRoutes.delete(
  '/admin/menu-items/:id',
  asyncHandler(async (req, res) => {
    await deleteMenuItemById(req.staff!.restaurantId, req.params.id);
    res.status(204).send();
  }),
);

adminRoutes.post(
  '/admin/tables',
  asyncHandler(async (req, res) => {
    const parsed = createTableSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid table payload', parsed.error.flatten());

    // req.staff carries restaurant_id, not the slug the QR code needs to
    // encode -- looked up once here rather than threading the slug through
    // the JWT.
    const restaurant = await findRestaurantById(req.staff!.restaurantId);
    const created = await createTableWithQrCode(restaurant.id, restaurant.slug, parsed.data.table_number);
    res.status(201).json(created);
  }),
);

adminRoutes.get(
  '/admin/tables',
  asyncHandler(async (req, res) => {
    // restaurant_slug alongside the tables list -- the admin frontend
    // needs it to construct/preview each table's ordering URL and QR
    // code client-side without a separate round trip per table.
    const [tables, restaurant] = await Promise.all([
      listTablesForRestaurant(req.staff!.restaurantId),
      findRestaurantById(req.staff!.restaurantId),
    ]);
    res.json({ tables, restaurant_slug: restaurant.slug });
  }),
);

// The emergency-handoff path, not routine table management -- normal
// assignment is automatic (round robin on first order/call-waiter, see
// tables.repository.ts). This exists for an admin moving an already-active
// table to a different waiter (sick, leaving mid-shift), which is why
// assignWaiterToTable has no "blocked while active" guard.
adminRoutes.patch(
  '/admin/tables/:id',
  asyncHandler(async (req, res) => {
    const parsed = assignWaiterSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid assignment payload', parsed.error.flatten());
    const table = await assignWaiterToTable(req.staff!.restaurantId, req.params.id, parsed.data.assigned_waiter_id);
    res.json(table);
  }),
);

// Both gated by "no active session" inside regenerateQrCodeForTable/
// removeTable -- rotating or removing a table out from under a customer
// mid-order would orphan them, so both are blocked until the table's
// closed.
adminRoutes.post(
  '/admin/tables/:id/regenerate-qr',
  asyncHandler(async (req, res) => {
    const restaurant = await findRestaurantById(req.staff!.restaurantId);
    const result = await regenerateQrCodeForTable(restaurant.id, restaurant.slug, req.params.id);
    res.json(result);
  }),
);

// Soft-delete (removed_at) rather than a real row delete -- the schema's
// order.table_session_id has ON DELETE RESTRICT specifically to protect
// order history, so a hard delete would simply fail for any table that's
// ever taken an order. This "delete" is what an admin experiences:
// the table disappears from every admin/staff view and its QR code stops
// resolving, but nothing is actually destroyed.
adminRoutes.delete(
  '/admin/tables/:id',
  asyncHandler(async (req, res) => {
    await removeTable(req.staff!.restaurantId, req.params.id);
    res.status(204).send();
  }),
);

adminRoutes.post(
  '/admin/staff',
  asyncHandler(async (req, res) => {
    const parsed = createStaffUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid staff user payload', parsed.error.flatten());
    const staffUser = await createStaffUserForRestaurant(req.staff!.restaurantId, parsed.data);
    res.status(201).json(staffUser);
  }),
);

adminRoutes.get(
  '/admin/staff',
  asyncHandler(async (req, res) => {
    const staff = await listStaffUsersForRestaurant(req.staff!.restaurantId);
    res.json({ staff });
  }),
);

adminRoutes.patch(
  '/admin/staff/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateStaffUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid staff update payload', parsed.error.flatten());
    const staffUser = await updateStaffUserForRestaurant(req.staff!.restaurantId, req.params.id, parsed.data);
    res.json(staffUser);
  }),
);

adminRoutes.delete(
  '/admin/staff/:id',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.staff!.sub) {
      throw new ForbiddenError('You cannot remove your own account');
    }
    await deleteStaffUser(req.staff!.restaurantId, req.params.id);
    res.status(204).send();
  }),
);

// Reads only report_order_fact/report_order_item_fact (see
// modules/reports/) -- never joins back to the operational tables above.
// "today" is always the live tile the admin room's sales_changed
// broadcast (fired by the reporting worker, not this Lambda) tells the
// frontend to refetch; summary/breakdown/export all take an explicit
// from/to range.
adminRoutes.get(
  '/admin/reports/today',
  asyncHandler(async (req, res) => {
    const summary = await getTodaySummary(req.staff!.restaurantId);
    res.json(summary);
  }),
);

adminRoutes.get(
  '/admin/reports/summary',
  asyncHandler(async (req, res) => {
    const parsed = dateRangeSchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Invalid report range', parsed.error.flatten());
    const summary = await getSummary(req.staff!.restaurantId, parsed.data.from, parsed.data.to);
    res.json(summary);
  }),
);

adminRoutes.get(
  '/admin/reports/breakdown',
  asyncHandler(async (req, res) => {
    const parsed = breakdownQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Invalid breakdown request', parsed.error.flatten());
    const breakdown = await getBreakdown(
      req.staff!.restaurantId,
      parsed.data.from,
      parsed.data.to,
      parsed.data.dimension,
    );
    res.json(breakdown);
  }),
);

adminRoutes.get(
  '/admin/reports/export',
  asyncHandler(async (req, res) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Invalid export request', parsed.error.flatten());
    const { body, contentType, filename } = await renderExport(
      req.staff!.restaurantId,
      parsed.data.from,
      parsed.data.to,
      parsed.data.format,
      parsed.data.dataset,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }),
);
