import { z } from 'zod';

export const platformAdminLoginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1),
});

export const resetAdminPasswordSchema = z.object({
  password: z.string().min(8).max(200),
});

export const restaurantModeSchema = z.object({
  mode: z.enum(['test', 'live']),
});

/**
 * The slug is typed by the operator, not sent from a hidden field, so
 * it is the one input here that actually proves intent. Kept a plain
 * string: the service compares it to the real slug exactly, and
 * validating its shape here would only turn a wrong-restaurant mistake
 * into a less specific error.
 */
export const resetRestaurantSchema = z.object({
  confirm_slug: z.string().min(1).max(100),
});
