import { z } from 'zod';
import { MAX_RANGE_DAYS } from './reports.constants';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Plain YYYY-MM-DD strings, not z.coerce.date() -- string comparison
// already sorts correctly for `from <= to`, and coercing to a JS Date
// would drag its UTC/local parsing ambiguity into a problem that's
// already solved by treating dates as Africa/Nairobi calendar days
// end to end (see reportDate.ts and report_date on the fact tables).
function daysBetween(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / msPerDay);
}

const dateRangeShape = {
  from: z.string().regex(DATE_RE, 'from must be YYYY-MM-DD'),
  to: z.string().regex(DATE_RE, 'to must be YYYY-MM-DD'),
};

function withRangeRefinements<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema
    .refine((r) => r.from <= r.to, { message: 'from must be on or before to' })
    .refine((r) => daysBetween(r.from, r.to) < MAX_RANGE_DAYS, {
      message: `Range cannot exceed ${MAX_RANGE_DAYS} days`,
    });
}

export const dateRangeSchema = withRangeRefinements(z.object(dateRangeShape));

export const breakdownDimensionSchema = z.enum(['menu_item', 'category', 'waiter', 'table']);
export const exportFormatSchema = z.enum(['csv', 'pdf', 'xlsx']);
export const csvDatasetSchema = z.enum(['menu_item', 'category', 'waiter', 'table', 'order_items']);

export const breakdownQuerySchema = withRangeRefinements(
  z.object({ ...dateRangeShape, dimension: breakdownDimensionSchema }),
);

export const exportQuerySchema = withRangeRefinements(
  z.object({ ...dateRangeShape, format: exportFormatSchema, dataset: csvDatasetSchema.optional() }),
);
