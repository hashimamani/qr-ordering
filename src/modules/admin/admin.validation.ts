import { z } from 'zod';

// Mirrors the restaurant_brand_color_hex CHECK constraint. Validated here
// as well as in the database because this value ends up interpolated into
// CSS custom properties client-side -- it should never reach the column,
// or a stylesheet, in a shape we didn't expect.
const brandColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'brand colour must be a 6-digit hex like #14b8a6');

export const restaurantSignupSchema = z.object({
  restaurant_name: z.string().min(1).max(200),
  restaurant_slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, and hyphens'),
  brand_color: brandColorSchema.optional(),
  admin_name: z.string().min(1).max(200),
  admin_phone_or_email: z.string().min(3).max(254),
  admin_password: z.string().min(8).max(200),
});

// Slug is deliberately absent: it's encoded into every QR code already
// printed and stuck to a table, so it can't change without reprinting them.
export const updateRestaurantBrandingSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  brand_color: brandColorSchema.nullable().optional(),
});

export const createMenuCategorySchema = z.object({
  name: z.string().min(1).max(200),
  sort_order: z.number().int().default(0),
});

export const updateMenuCategorySchema = createMenuCategorySchema.partial();

export const createMenuItemSchema = z.object({
  category_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative(),
  destination: z.enum(['kitchen', 'bar']),
  is_available: z.boolean().default(true),
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

export const createTableSchema = z.object({
  table_number: z.string().min(1).max(50),
});

export const assignWaiterSchema = z.object({
  assigned_waiter_id: z.string().uuid(),
});

export const destinationParamSchema = z.object({
  destination: z.enum(['kitchen', 'bar']),
});

// Note the absence of an ordering constraint here: unlike the staff
// endpoint, an admin override may target *any* status, including one
// earlier than the item's current one. The legality of the specific
// move is decided in transitionOrderItemStatus, which knows the current
// status; this only validates the shape.
export const overrideStatusSchema = z.object({
  status: z.enum(['received', 'preparing', 'ready', 'served']),
  reason: z.string().max(500).trim().optional(),
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
