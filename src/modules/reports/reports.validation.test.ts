import { describe, it, expect } from 'vitest';
import { dateRangeSchema, breakdownQuerySchema, exportQuerySchema } from './reports.validation';

describe('dateRangeSchema', () => {
  it('accepts a valid range', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-01-01', to: '2026-01-31' }).success).toBe(true);
  });

  it('accepts a single-day range', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-01-01', to: '2026-01-01' }).success).toBe(true);
  });

  it('rejects from after to', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-1-1', to: '2026-01-31' }).success).toBe(false);
    expect(dateRangeSchema.safeParse({ from: '01-01-2026', to: '2026-01-31' }).success).toBe(false);
  });

  it('rejects a range longer than 366 days', () => {
    expect(dateRangeSchema.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(false);
  });

  it('accepts a range of exactly 365 days', () => {
    expect(dateRangeSchema.safeParse({ from: '2025-01-01', to: '2025-12-31' }).success).toBe(true);
  });
});

describe('breakdownQuerySchema', () => {
  it('accepts a valid dimension', () => {
    const result = breakdownQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-31', dimension: 'waiter' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown dimension', () => {
    const result = breakdownQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-31', dimension: 'bogus' });
    expect(result.success).toBe(false);
  });
});

describe('exportQuerySchema', () => {
  it('accepts a valid format with no dataset', () => {
    const result = exportQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-31', format: 'pdf' });
    expect(result.success).toBe(true);
  });

  it('accepts csv with a dataset', () => {
    const result = exportQuerySchema.safeParse({
      from: '2026-01-01',
      to: '2026-01-31',
      format: 'csv',
      dataset: 'order_items',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown format', () => {
    const result = exportQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-31', format: 'docx' });
    expect(result.success).toBe(false);
  });
});
