import crypto from 'crypto';
import type { NotificationStatus } from './notifications.types';

/**
 * Meta's side of the WhatsApp integration: the verification handshake
 * and the delivery-status callbacks.
 *
 * Kept free of Express and the database so the two things most likely to
 * be wrong -- the signature check and the shape of Meta's payload -- can
 * be asserted directly. A signature bug is invisible in testing (every
 * real callback still works; only forged ones get through) and the
 * payload is deeply nested enough that a wrong path silently yields
 * zero updates rather than an error.
 */

/** What Meta calls the status, and what we store it as. */
const STATUS_MAP: Record<string, NotificationStatus> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  // Meta's "failed" means it accepted the message and then could not
  // deliver it. Ours means the send itself was rejected. Keeping them
  // apart is the whole point of the 'undelivered' value.
  failed: 'undelivered',
};

/**
 * Status only ever moves forward. Meta does not guarantee callback
 * order, and out-of-order arrival is routine -- a 'read' can land before
 * the 'delivered' for the same message -- so without a rank a late
 * 'sent' would overwrite a 'read' and the log would get less accurate
 * over time.
 *
 * 'undelivered' sits deliberately between 'sent' and 'delivered'. It
 * must beat 'sent', or a real non-delivery would be lost; it must NOT
 * beat 'delivered' or 'read', because those are positive evidence the
 * message arrived and a later failure callback cannot unmake a message
 * the customer has already opened. One ordering expresses both rules, so
 * there is no separate "terminal" case to get wrong.
 *
 * 'failed' is rank 0 and unreachable from here: it means Meta rejected
 * the send, in which case there is no message id to match a callback
 * against.
 */
const PROGRESS: Record<string, number> = { failed: 0, sent: 1, undelivered: 2, delivered: 3, read: 4 };

export function statusRank(status: NotificationStatus): number {
  return PROGRESS[status] ?? 0;
}

export interface DeliveryStatusUpdate {
  providerMessageId: string;
  status: NotificationStatus;
  /** Meta's own error text, when it gave one -- worth keeping verbatim. */
  detail?: string;
  /**
   * Meta's own epoch-seconds timestamp for the status.
   *
   * Without it, "how long did delivery take" can only be inferred from
   * when the callback reached us, which conflates three separate things:
   * Meta accepting the message, the handset actually receiving it, and
   * the callback travelling back to us. The gap between a 'sent' and a
   * 'delivered' timestamp is the recipient's device being reachable --
   * not something any amount of tuning on our side can change.
   */
  timestamp?: number;
}

/**
 * Validates X-Hub-Signature-256 over the RAW request body.
 *
 * Must be the raw bytes, not a re-serialised JSON.stringify of the
 * parsed object: key order and whitespace both change the hash, so
 * re-serialising produces a mismatch on perfectly genuine callbacks.
 *
 * Without this check the endpoint is unauthenticated and world-reachable
 * -- anyone could POST "delivered" for any message id they guessed, or
 * bury real failures under fake successes.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, which would itself leak
  // information through the error path.
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

/**
 * Answers the subscription handshake. Meta sends this once when the
 * callback URL is saved, and expects hub.challenge echoed back verbatim
 * as plain text -- a JSON-wrapped or quoted challenge is rejected and
 * the webhook simply never activates.
 */
export function verifyChallenge(
  query: Record<string, unknown>,
  expectedToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || typeof challenge !== 'string') return { ok: false };
  if (!expectedToken || typeof token !== 'string') return { ok: false };

  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, challenge };
}

/**
 * Digs the status entries out of Meta's envelope.
 *
 * The shape is entry[] -> changes[] -> value.statuses[], and every level
 * is optional in practice: a callback can carry inbound messages
 * instead of statuses, or a field we do not handle at all. Anything
 * unrecognised is skipped rather than throwing, because a throw here
 * means a non-2xx response, and Meta disables a webhook that keeps
 * failing.
 */
export function parseStatusUpdates(payload: unknown): DeliveryStatusUpdate[] {
  const updates: DeliveryStatusUpdate[] = [];
  const root = payload as { entry?: unknown[] } | null;
  if (!root || !Array.isArray(root.entry)) return updates;

  for (const entry of root.entry) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown[] } })?.value?.statuses;
      if (!Array.isArray(statuses)) continue;

      for (const raw of statuses) {
        const s = raw as { id?: unknown; status?: unknown; errors?: unknown };
        if (typeof s.id !== 'string' || typeof s.status !== 'string') continue;
        const mapped = STATUS_MAP[s.status];
        if (!mapped) continue;

        let detail: string | undefined;
        if (Array.isArray(s.errors) && s.errors.length > 0) {
          const e = s.errors[0] as { code?: unknown; title?: unknown; message?: unknown };
          detail = [e.code, e.message ?? e.title].filter(Boolean).join(': ') || undefined;
        }
        const ts = Number((raw as { timestamp?: unknown }).timestamp);
        updates.push({
          providerMessageId: s.id,
          status: mapped,
          detail,
          timestamp: Number.isFinite(ts) && ts > 0 ? ts : undefined,
        });
      }
    }
  }
  return updates;
}

/**
 * Inbound customer messages. We do not reply to these -- there is no
 * conversational flow -- but they are worth noticing: an inbound message
 * opens Meta's 24-hour customer-service window, which is the only time
 * free-form (non-template) messages are allowed.
 */
export function parseInboundMessageCount(payload: unknown): number {
  const root = payload as { entry?: unknown[] } | null;
  if (!root || !Array.isArray(root.entry)) return 0;
  let count = 0;
  for (const entry of root.entry) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown[] } })?.value?.messages;
      if (Array.isArray(messages)) count += messages.length;
    }
  }
  return count;
}
