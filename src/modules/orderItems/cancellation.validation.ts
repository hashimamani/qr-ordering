import { z } from 'zod';

/**
 * Both the customer and staff routes take the same optional item id:
 * absent means "the whole order", present means one line. Staff may also
 * give a reason, which the audit row keeps.
 */
export const cancelOrderSchema = z.object({
  order_item_id: z.string().uuid().optional(),
});

export const staffCancelOrderSchema = cancelOrderSchema.extend({
  reason: z.string().max(500).trim().optional(),
});
