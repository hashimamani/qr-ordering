import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/errors';
import { requireStaffAuth, requireRole } from '../middleware/staffAuth';
import { requirePlatformAdminKey } from '../middleware/platformAdminAuth';
import {
  restaurantSignupSchema,
  createMenuCategorySchema,
  updateMenuCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  createTableSchema,
} from '../modules/admin/admin.validation';
import { createStaffUserSchema } from '../modules/staff/staff.validation';
import {
  signUpRestaurant,
  createMenuItemForRestaurant,
  createTableWithQrCode,
  createStaffUserForRestaurant,
} from '../modules/admin/admin.service';
import {
  insertMenuCategory,
  updateMenuCategoryById,
  deleteMenuCategoryById,
  updateMenuItemById,
  deleteMenuItemById,
  listTablesForRestaurant,
} from '../modules/admin/admin.repository';
import { listMenuForRestaurant } from '../modules/menu/menu.repository';
import { listStaffUsersForRestaurant } from '../modules/staff/staff.repository';
import { findRestaurantById } from '../modules/tables/tables.repository';

export const adminRoutes = Router();

adminRoutes.post(
  '/admin/restaurants/signup',
  requirePlatformAdminKey,
  asyncHandler(async (req, res) => {
    const parsed = restaurantSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid signup payload', parsed.error.flatten());
    }
    const result = await signUpRestaurant(parsed.data);
    res.status(201).json(result);
  }),
);

adminRoutes.use(requireStaffAuth, requireRole('admin'));

adminRoutes.get(
  '/admin/menu',
  asyncHandler(async (req, res) => {
    const menu = await listMenuForRestaurant(req.staff!.restaurantId);
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
