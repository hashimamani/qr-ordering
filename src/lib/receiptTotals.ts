/**
 * Splits a VAT-inclusive total into net and tax.
 *
 * Prices in this system are what the customer pays, so VAT is extracted
 * from the total rather than added to it:
 *
 *   vat = total x rate / (100 + rate)
 *
 * Adding it on top instead would print a different figure from the
 * amount actually charged, which on a financial document is not a
 * rounding preference but a wrong number.
 *
 * Everything is computed in integer cents. Floating point would make
 * net + vat fail to equal total for perfectly ordinary amounts, and a
 * receipt whose lines do not add up is worse than one with no breakdown
 * at all. The tax is rounded once and the net is derived by subtraction,
 * so the two always reconcile exactly to the total by construction.
 */

export interface VatBreakdown {
  /** Total excluding tax, in the same major units as the input. */
  net: string;
  /** Tax contained within the total. */
  vat: string;
  /** Unchanged from the input -- what the customer actually paid. */
  total: string;
  /** The rate applied, for labelling ("VAT (16%)"). */
  ratePercent: number;
}

function toCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Returns undefined when no breakdown should be shown -- a zero or
 * missing rate means the restaurant is not presenting VAT, and printing
 * "VAT 0.00" would imply a registration it may not have.
 */
export function vatBreakdown(
  total: string | number,
  ratePercent: string | number | null | undefined,
): VatBreakdown | undefined {
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;

  const totalCents = toCents(total);
  if (!Number.isFinite(totalCents) || totalCents <= 0) return undefined;

  const vatCents = Math.round((totalCents * rate) / (100 + rate));
  return {
    net: fromCents(totalCents - vatCents),
    vat: fromCents(vatCents),
    total: fromCents(totalCents),
    // Trailing zeros dropped so 16.00 reads as "16%", not "16.00%".
    ratePercent: Number(rate.toFixed(2)),
  };
}
