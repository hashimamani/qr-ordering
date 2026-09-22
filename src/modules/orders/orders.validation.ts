import { z } from 'zod';
import { ValidationError } from '../../lib/errors';

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        menu_item_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
        notes: z.string().max(500).trim().optional(),
      }),
    )
    .min(1, 'Order must contain at least one item')
    .max(50, 'Too many line items in a single order'),
  contact_channel: z.enum(['sms', 'email']),
  contact_value: z.string().min(3).max(254),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

const E164_PHONE = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertContactValueMatchesChannel(input: CreateOrderInput): void {
  if (input.contact_channel === 'sms' && !E164_PHONE.test(input.contact_value)) {
    throw new ValidationError('contact_value must be an E.164 phone number (e.g. +2547XXXXXXXX) for sms channel');
  }
  if (input.contact_channel === 'email' && !EMAIL.test(input.contact_value)) {
    throw new ValidationError('contact_value must be a valid email address for email channel');
  }
}
