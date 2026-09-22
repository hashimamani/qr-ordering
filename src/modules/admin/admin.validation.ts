import { z } from 'zod';

export const restaurantSignupSchema = z.object({
  restaurant_name: z.string().min(1).max(200),
  restaurant_slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, and hyphens'),
  admin_name: z.string().min(1).max(200),
  admin_phone_or_email: z.string().min(3).max(254),
  admin_password: z.string().min(8).max(200),
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
