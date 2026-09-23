import { z } from 'zod';

export const platformAdminLoginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1),
});
