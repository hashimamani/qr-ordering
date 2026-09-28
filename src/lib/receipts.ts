import crypto from 'crypto';

const PUBLIC_BASE_URL =
  process.env.PUBLIC_ORDERING_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

/**
 * How long a receipt link stays live. Platform-wide rather than
 * per-restaurant: receipt retention is a policy that should be consistent
 * across tenants, and it's not a choice most restaurant admins have any
 * basis to make.
 */
export function receiptTtlHours(): number {
  const raw = Number(process.env.RECEIPT_LINK_TTL_HOURS);
  // Read per-call, not at module load, so tests can vary it without
  // re-importing. Anything absent, non-numeric or <= 0 falls back rather
  // than producing a link that is already expired when it's sent.
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

export function receiptExpiryFrom(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + receiptTtlHours() * 60 * 60 * 1000);
}

export function receiptUrlFor(token: string): string {
  return `${PUBLIC_BASE_URL}/receipt/${token}`;
}

/** 256 bits, URL-safe. Only its hash is ever stored. */
export function generateReceiptToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashReceiptToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export type ContactChannel = 'sms' | 'email';

/**
 * How many wrong answers burn the link. IP rate limiting alone doesn't
 * cover this -- the last-4 challenge is only 10,000 combinations and an
 * attacker can rotate addresses -- so the cap lives with the receipt.
 */
export const MAX_FAILED_ATTEMPTS = 10;

/**
 * What the viewer must supply to prove they're the order's contact.
 *
 * For sms that's the last 4 digits: contact_value is stored E.164
 * normalised (see normalizeContactValue in orders.validation.ts), so
 * "last 4" is unambiguous.
 *
 * For email it's the whole address. Four characters of an address is
 * usually '.com', which proves nothing -- there's no meaningful short
 * suffix to ask for, so the full string is the only real check.
 */
export function challengeMatches(
  channel: ContactChannel,
  contactValue: string,
  answer: string,
): boolean {
  const given = answer.trim();
  if (!given) return false;

  if (channel === 'sms') {
    const digits = contactValue.replace(/\D/g, '');
    const expected = digits.slice(-4);
    // Tolerate someone typing the whole number, but never a prefix match.
    const givenDigits = given.replace(/\D/g, '');
    if (expected.length < 4) return false;
    return timingSafeEqual(givenDigits.slice(-4), expected) && givenDigits.length >= 4;
  }

  return timingSafeEqual(given.toLowerCase(), contactValue.trim().toLowerCase());
}

/**
 * Length is not secret here (4 digits, or an address the holder can see
 * in their own inbox), so comparing lengths first leaks nothing; the
 * constant-time compare covers the content.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
