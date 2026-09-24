import { z } from 'zod';

export const platformAdminLoginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1),
});

export const resetAdminPasswordSchema = z.object({
  password: z.string().min(8).max(200),
});
