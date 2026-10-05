import { describe, it, expect } from 'vitest';
import { vatBreakdown } from './receiptTotals';

/**
 * The property that matters on a receipt is that the printed lines add
 * up to the printed total, exactly, for every amount -- a customer who
 * adds the column and gets a different number has caught the business
 * out. So the reconciliation is checked exhaustively rather than on a
 * couple of convenient examples.
 */
describe('VAT extracted from an inclusive total', () => {
  it('splits a round total at the Kenyan standard rate', () => {
    // 500 inclusive of 16%: 500 * 16/116 = 68.9655...
    expect(vatBreakdown('500.00', 16)).toEqual({
      net: '431.03',
      vat: '68.97',
      total: '500.00',
      ratePercent: 16,
    });
  });

  it('never changes the total -- it is what was charged', () => {
    for (const total of ['0.01', '1.00', '99.99', '1234.56', '250000.00']) {
      expect(vatBreakdown(total, 16)?.total).toBe(Number(total).toFixed(2));
    }
  });

  // The whole reason this is computed in integer cents.
  it('always reconciles: net + vat === total, across many amounts', () => {
    for (let cents = 1; cents <= 20000; cents += 7) {
      const total = (cents / 100).toFixed(2);
      for (const rate of [16, 8, 14, 7.5, 12.5]) {
        const b = vatBreakdown(total, rate)!;
        const sum = (Number(b.net) * 100 + Number(b.vat) * 100) / 100;
        expect(sum.toFixed(2)).toBe(b.total);
      }
    }
  });

  it('accepts the rate as a numeric string, as Postgres returns it', () => {
    expect(vatBreakdown('500.00', '16.00')).toEqual(vatBreakdown('500.00', 16));
  });

  it('labels 16.00 as 16, not 16.00', () => {
    expect(vatBreakdown('500.00', '16.00')!.ratePercent).toBe(16);
    expect(vatBreakdown('500.00', '7.50')!.ratePercent).toBe(7.5);
  });

  // Printing "VAT 0.00" would imply a registration the restaurant may
  // not hold, so no rate means no breakdown at all.
  it('shows nothing when the restaurant presents no VAT', () => {
    for (const rate of [0, '0.00', null, undefined, NaN, -5]) {
      expect(vatBreakdown('500.00', rate as never)).toBeUndefined();
    }
  });

  it('shows nothing for a zero or nonsensical total', () => {
    for (const total of ['0.00', '-10.00']) {
      expect(vatBreakdown(total, 16)).toBeUndefined();
    }
  });

  it('handles a total small enough that the tax rounds to a cent', () => {
    const b = vatBreakdown('0.10', 16)!;
    expect(Number(b.net) + Number(b.vat)).toBeCloseTo(0.1, 10);
  });
});
