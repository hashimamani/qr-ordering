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

/**
 * Accepts Kenyan mobile numbers in any of the common local forms --
 * 0712345678, 712345678, or already-E.164 +254712345678 -- and
 * normalizes to E.164 before validation/storage, since E.164 is the only
 * form Africa's Talking (and assertContactValueMatchesChannel below)
 * accepts. Anything that doesn't match one of these shapes is passed
 * through unchanged so the existing E164_PHONE check still rejects it
 * with its normal error rather than silently mangling it. Email contact
 * values are untouched.
 */
export function normalizeContactValue(input: CreateOrderInput): CreateOrderInput {
  if (input.contact_channel !== 'sms') return input;
  const trimmed = input.contact_value.trim().replace(/[\s-]/g, '');
  let normalized = trimmed;
  if (/^0\d{9}$/.test(trimmed)) {
    normalized = `+254${trimmed.slice(1)}`;
  } else if (/^\d{9}$/.test(trimmed)) {
    normalized = `+254${trimmed}`;
  }
  return { ...input, contact_value: normalized };
}

export function assertContactValueMatchesChannel(input: CreateOrderInput): void {
  if (input.contact_channel === 'sms' && !E164_PHONE.test(input.contact_value)) {
    throw new ValidationError('contact_value must be an E.164 phone number (e.g. +2547XXXXXXXX) for sms channel');
  }
  if (input.contact_channel === 'email' && !EMAIL.test(input.contact_value)) {
    throw new ValidationError('contact_value must be a valid email address for email channel');
  }
}
