import { z } from 'zod';
import { STAFF_ROLES } from '../../lib/domain';

// From the shared list: this enum omitting a role meant the API would
// refuse to create staff for a station that otherwise existed end to end.
const roleEnum = z.enum(
  STAFF_ROLES as unknown as [string, ...string[]],
) as z.ZodEnum<['admin', 'waiter', 'kitchen', 'bar', 'services']>;

export const staffLoginSchema = z.object({
  restaurant_slug: z.string().min(1),
  phone_or_email: z.string().min(3).max(254),
  password: z.string().min(1),
});

export const createStaffUserSchema = z.object({
  name: z.string().min(1).max(200),
  role: roleEnum,
  phone_or_email: z.string().min(3).max(254),
  password: z.string().min(8).max(200),
});

export const updateStaffUserSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    role: roleEnum.optional(),
    phone_or_email: z.string().min(3).max(254).optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  });

export const resetStaffPasswordSchema = z.object({
  password: z.string().min(8).max(200),
});

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
