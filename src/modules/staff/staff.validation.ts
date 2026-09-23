import { z } from 'zod';

export const staffLoginSchema = z.object({
  restaurant_slug: z.string().min(1),
  phone_or_email: z.string().min(3).max(254),
  password: z.string().min(1),
});

export const createStaffUserSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(['admin', 'waiter', 'kitchen', 'bar']),
  phone_or_email: z.string().min(3).max(254),
  password: z.string().min(8).max(200),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
