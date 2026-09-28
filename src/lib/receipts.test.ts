import { describe, it, expect, afterEach } from 'vitest';
import {
  challengeMatches,
  receiptTtlHours,
  receiptExpiryFrom,
  generateReceiptToken,
  hashReceiptToken,
} from './receipts';

const ORIGINAL_TTL = process.env.RECEIPT_LINK_TTL_HOURS;
afterEach(() => {
  if (ORIGINAL_TTL === undefined) delete process.env.RECEIPT_LINK_TTL_HOURS;
  else process.env.RECEIPT_LINK_TTL_HOURS = ORIGINAL_TTL;
});

describe('challengeMatches - sms', () => {
  const NUMBER = '+254712345678';

  it('accepts the last four digits', () => {
    expect(challengeMatches('sms', NUMBER, '5678')).toBe(true);
  });

  it('accepts the full number too', () => {
    expect(challengeMatches('sms', NUMBER, NUMBER)).toBe(true);
    expect(challengeMatches('sms', NUMBER, '0712345678')).toBe(true);
  });

  it('ignores spaces and punctuation the customer might type', () => {
    expect(challengeMatches('sms', NUMBER, ' 5678 ')).toBe(true);
    expect(challengeMatches('sms', NUMBER, '56-78')).toBe(true);
  });

  it('rejects the wrong digits', () => {
    expect(challengeMatches('sms', NUMBER, '5679')).toBe(false);
    expect(challengeMatches('sms', NUMBER, '1234')).toBe(false);
  });

  // The whole point of the second factor: a shorter answer must never
  // pass by matching a prefix or suffix of the real one.
  it('rejects a partial answer', () => {
    expect(challengeMatches('sms', NUMBER, '678')).toBe(false);
    expect(challengeMatches('sms', NUMBER, '78')).toBe(false);
    expect(challengeMatches('sms', NUMBER, '8')).toBe(false);
  });

  it('rejects empty and whitespace answers', () => {
    expect(challengeMatches('sms', NUMBER, '')).toBe(false);
    expect(challengeMatches('sms', NUMBER, '   ')).toBe(false);
  });

  it('rejects a non-numeric answer', () => {
    expect(challengeMatches('sms', NUMBER, 'abcd')).toBe(false);
  });
});

describe('challengeMatches - email', () => {
  const EMAIL = 'Jane.Doe@Example.com';

  it('accepts the address case-insensitively', () => {
    expect(challengeMatches('email', EMAIL, 'jane.doe@example.com')).toBe(true);
    expect(challengeMatches('email', EMAIL, ' Jane.Doe@Example.com ')).toBe(true);
  });

  it('rejects a different address', () => {
    expect(challengeMatches('email', EMAIL, 'john.doe@example.com')).toBe(false);
  });

  // Guarding the reason email doesn't use a 4-character suffix.
  it('rejects a suffix of the address', () => {
    expect(challengeMatches('email', EMAIL, '.com')).toBe(false);
    expect(challengeMatches('email', EMAIL, 'example.com')).toBe(false);
  });

  it('rejects empty answers', () => {
    expect(challengeMatches('email', EMAIL, '')).toBe(false);
  });
});

describe('receiptTtlHours', () => {
  it('defaults to 24 when unset', () => {
    delete process.env.RECEIPT_LINK_TTL_HOURS;
    expect(receiptTtlHours()).toBe(24);
  });

  it('honours a configured value', () => {
    process.env.RECEIPT_LINK_TTL_HOURS = '72';
    expect(receiptTtlHours()).toBe(72);
  });

  // A bad value must not yield a link that's already dead on arrival.
  it.each(['0', '-5', 'abc', ''])('falls back to 24 for %o', (value) => {
    process.env.RECEIPT_LINK_TTL_HOURS = value;
    expect(receiptTtlHours()).toBe(24);
  });

  it('computes expiry from the issue time', () => {
    process.env.RECEIPT_LINK_TTL_HOURS = '2';
    const issued = new Date('2026-01-01T00:00:00Z');
    expect(receiptExpiryFrom(issued).toISOString()).toBe('2026-01-01T02:00:00.000Z');
  });
});

describe('receipt tokens', () => {
  it('generates distinct, URL-safe tokens', () => {
    const a = generateReceiptToken();
    const b = generateReceiptToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it('hashes deterministically and irreversibly', () => {
    const token = generateReceiptToken();
    expect(hashReceiptToken(token)).toBe(hashReceiptToken(token));
    expect(hashReceiptToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashReceiptToken(token)).not.toContain(token);
  });
});
