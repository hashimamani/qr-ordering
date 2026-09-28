import jwt from 'jsonwebtoken';
import { logger } from '../../lib/logger';
import { NotFoundError, UnauthorizedError } from '../../lib/errors';
import {
  challengeMatches,
  generateReceiptToken,
  hashReceiptToken,
  receiptExpiryFrom,
  receiptUrlFor,
  MAX_FAILED_ATTEMPTS,
} from '../../lib/receipts';
import {
  findReceiptByTokenHash,
  findReceiptDetail,
  insertReceipt,
  markReceiptViewed,
  recordFailedAttempt,
  type ReceiptDetail,
} from './receipts.repository';

/** Long enough to read the receipt and hit download, short enough to be worthless if leaked. */
const DOWNLOAD_GRANT_TTL_SECONDS = 15 * 60;

/**
 * Every rejection -- unknown token, expired, burnt by failed attempts,
 * wrong answer -- surfaces through this one message. Distinguishing them
 * would tell someone probing links which ones are real and still live.
 */
const GENERIC_REJECTION = 'This receipt link is invalid or has expired';

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export interface IssuedReceipt {
  token: string;
  url: string;
}

/**
 * Mints a receipt link for a freshly-paid order. Returns undefined when
 * one already existed -- the caller must not send a second message, since
 * only the original token works.
 */
export async function issueReceiptForOrder(orderId: string): Promise<IssuedReceipt | undefined> {
  const token = generateReceiptToken();
  const created = await insertReceipt(orderId, hashReceiptToken(token), receiptExpiryFrom(new Date()));
  if (!created) {
    logger.info({ orderId }, 'receipt already issued for this order; not re-issuing');
    return undefined;
  }
  return { token, url: receiptUrlFor(token) };
}

export interface ChallengePrompt {
  channel: 'sms' | 'email';
  /** A masked hint, never the contact itself -- enough to recognise, not enough to answer. */
  hint: string;
}

/**
 * Pre-challenge probe. Says only whether the link is live and what to
 * ask for. Deliberately returns nothing about the order: the viewer has
 * not proved anything yet.
 */
export async function describeReceiptChallenge(token: string): Promise<ChallengePrompt> {
  const receipt = await findReceiptByTokenHash(hashReceiptToken(token));
  if (!receipt || isUnusable(receipt.expires_at, receipt.failed_attempts)) {
    throw new NotFoundError(GENERIC_REJECTION);
  }

  if (receipt.contact_channel === 'sms') {
    // Shows the leading digits and hides the rest. Masking the *end*
    // rather than the start is the point: the last 4 is the answer, so a
    // hint that revealed it would defeat the challenge. The prefix is
    // enough to recognise which of your numbers this was sent to.
    return { channel: 'sms', hint: maskPhone(receipt.contact_value) };
  }
  return { channel: 'email', hint: maskEmail(receipt.contact_value) };
}

export interface VerifiedReceipt {
  receipt: ReceiptDetail;
  download_grant: string;
}

export async function verifyAndLoadReceipt(token: string, answer: string): Promise<VerifiedReceipt> {
  const receipt = await findReceiptByTokenHash(hashReceiptToken(token));
  if (!receipt || isUnusable(receipt.expires_at, receipt.failed_attempts)) {
    throw new NotFoundError(GENERIC_REJECTION);
  }

  if (!challengeMatches(receipt.contact_channel, receipt.contact_value, answer)) {
    const attempts = await recordFailedAttempt(receipt.receipt_id);
    logger.warn(
      { receiptId: receipt.receipt_id, attempts },
      attempts >= MAX_FAILED_ATTEMPTS ? 'receipt link burnt after repeated failures' : 'receipt challenge failed',
    );
    throw new UnauthorizedError("That doesn't match the contact this receipt was sent to");
  }

  const detail = await findReceiptDetail(receipt.order_id);
  if (!detail) throw new NotFoundError(GENERIC_REJECTION);

  await markReceiptViewed(receipt.receipt_id);

  // A short-lived bearer grant, so the challenge answer never has to be
  // replayed into the PDF URL, where it would land in access logs and
  // browser history.
  const download_grant = jwt.sign({ rid: receipt.receipt_id, oid: receipt.order_id }, requireSecret(), {
    expiresIn: DOWNLOAD_GRANT_TTL_SECONDS,
  });

  return { receipt: detail, download_grant };
}

/** Validates a download grant and returns the receipt it covers. */
export async function loadReceiptForDownload(token: string, grant: string): Promise<ReceiptDetail> {
  let payload: { rid: string; oid: string };
  try {
    payload = jwt.verify(grant, requireSecret()) as { rid: string; oid: string };
  } catch {
    throw new UnauthorizedError('Your download link has expired -- reopen the receipt');
  }

  // The grant is checked against the token in the URL, so a grant for one
  // receipt can't be replayed against another.
  const receipt = await findReceiptByTokenHash(hashReceiptToken(token));
  if (!receipt || receipt.receipt_id !== payload.rid) {
    throw new NotFoundError(GENERIC_REJECTION);
  }
  if (isUnusable(receipt.expires_at, receipt.failed_attempts)) {
    throw new NotFoundError(GENERIC_REJECTION);
  }

  const detail = await findReceiptDetail(receipt.order_id);
  if (!detail) throw new NotFoundError(GENERIC_REJECTION);
  return detail;
}

function isUnusable(expiresAt: string, failedAttempts: number): boolean {
  return new Date(expiresAt) <= new Date() || failedAttempts >= MAX_FAILED_ATTEMPTS;
}

function maskPhone(contactValue: string): string {
  const trimmed = contactValue.trim();
  const visible = trimmed.slice(0, 5);
  return `${visible}${'•'.repeat(Math.max(trimmed.length - 5, 0))}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const shown = local.slice(0, 1);
  return `${shown}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}
