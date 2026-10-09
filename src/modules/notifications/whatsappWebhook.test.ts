import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  verifyWebhookSignature,
  verifyChallenge,
  parseStatusUpdates,
  parseInboundMessageCount,
  statusRank,
} from './whatsappWebhook';

const APP_SECRET = 'test-app-secret';

function sign(body: string, secret = APP_SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

/** The envelope Meta actually sends, trimmed to the parts we read. */
function statusPayload(statuses: unknown[]) {
  return { object: 'whatsapp_business_account', entry: [{ id: '1818423152739572', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses } }] }] };
}

describe('webhook signature', () => {
  it('accepts a correctly signed body', () => {
    const body = JSON.stringify(statusPayload([]));
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), APP_SECRET)).toBe(true);
  });

  it('rejects a body that was tampered with after signing', () => {
    const body = JSON.stringify(statusPayload([]));
    const signature = sign(body);
    const tampered = body.replace('whatsapp_business_account', 'whatsapp_business_accounx');
    expect(verifyWebhookSignature(Buffer.from(tampered), signature, APP_SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    const body = JSON.stringify(statusPayload([]));
    expect(verifyWebhookSignature(Buffer.from(body), sign(body, 'wrong'), APP_SECRET)).toBe(false);
  });

  // An unconfigured app secret must not degrade into "accept everything".
  it('rejects when no app secret is configured', () => {
    const body = JSON.stringify(statusPayload([]));
    expect(verifyWebhookSignature(Buffer.from(body), sign(body), '')).toBe(false);
  });

  it('rejects a missing or malformed signature header', () => {
    const body = Buffer.from('{}');
    expect(verifyWebhookSignature(body, undefined, APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=nothex', APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=', APP_SECRET)).toBe(false);
  });

  // A short hex string must not slip past: timingSafeEqual throws on a
  // length mismatch, so the length check has to come first.
  it('rejects a truncated signature without throwing', () => {
    const body = JSON.stringify(statusPayload([]));
    const short = sign(body).slice(0, 20);
    expect(() => verifyWebhookSignature(Buffer.from(body), short, APP_SECRET)).not.toThrow();
    expect(verifyWebhookSignature(Buffer.from(body), short, APP_SECRET)).toBe(false);
  });

  // Re-serialising the parsed object changes the bytes; the raw body is
  // the only thing that hashes to Meta's signature.
  it('fails if the body is re-serialised rather than kept raw', () => {
    // Meta sends pretty-printed JSON; JSON.stringify would strip the
    // whitespace and hash differently. (Key order survives a round trip,
    // so whitespace is the difference that actually bites.)
    const original = '{\n  "object": "whatsapp_business_account"\n}';
    const reserialised = JSON.stringify(JSON.parse(original));
    expect(reserialised).not.toBe(original);
    expect(verifyWebhookSignature(Buffer.from(original), sign(original), APP_SECRET)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(reserialised), sign(original), APP_SECRET)).toBe(false);
  });
});

describe('subscription handshake', () => {
  const TOKEN = 'verify-me';

  it('echoes the challenge when the token matches', () => {
    const r = verifyChallenge(
      { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1158201444' },
      TOKEN,
    );
    expect(r).toEqual({ ok: true, challenge: '1158201444' });
  });

  it('refuses a wrong token, a wrong mode, or no configured token', () => {
    const base = { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': 'c' };
    expect(verifyChallenge({ ...base, 'hub.verify_token': 'nope' }, TOKEN).ok).toBe(false);
    expect(verifyChallenge({ ...base, 'hub.mode': 'unsubscribe' }, TOKEN).ok).toBe(false);
    expect(verifyChallenge(base, '').ok).toBe(false);
    expect(verifyChallenge({}, TOKEN).ok).toBe(false);
  });
});

describe('status parsing', () => {
  it('maps Meta statuses onto ours, failed becoming undelivered', () => {
    const updates = parseStatusUpdates(
      statusPayload([
        { id: 'wamid.A', status: 'sent' },
        { id: 'wamid.B', status: 'delivered' },
        { id: 'wamid.C', status: 'read' },
        { id: 'wamid.D', status: 'failed' },
      ]),
    );
    expect(updates.map((u) => [u.providerMessageId, u.status])).toEqual([
      ['wamid.A', 'sent'],
      ['wamid.B', 'delivered'],
      ['wamid.C', 'read'],
      ['wamid.D', 'undelivered'],
    ]);
  });

  it('keeps Meta error detail on a failure', () => {
    const [u] = parseStatusUpdates(
      statusPayload([
        {
          id: 'wamid.E',
          status: 'failed',
          errors: [{ code: 131026, title: 'Message undeliverable', message: 'Receiver is incapable of receiving this message' }],
        },
      ]),
    );
    expect(u.detail).toContain('131026');
    expect(u.detail).toContain('Receiver is incapable');
  });

  // A malformed or unexpected payload must yield nothing rather than
  // throw: a throw becomes a non-2xx, and Meta disables a callback URL
  // that keeps failing.
  it('returns nothing for payloads it does not understand, without throwing', () => {
    for (const payload of [null, undefined, {}, { entry: 'not-an-array' }, { entry: [{}] }, { entry: [{ changes: [{}] }] }, statusPayload([{ id: 'x' }]), statusPayload([{ status: 'sent' }]), statusPayload([{ id: 'y', status: 'invented' }])]) {
      expect(() => parseStatusUpdates(payload)).not.toThrow();
      expect(parseStatusUpdates(payload)).toEqual([]);
    }
  });

  it('reads statuses from every entry and change, not just the first', () => {
    const payload = {
      entry: [
        { changes: [{ value: { statuses: [{ id: 'a', status: 'sent' }] } }, { value: { statuses: [{ id: 'b', status: 'read' }] } }] },
        { changes: [{ value: { statuses: [{ id: 'c', status: 'delivered' }] } }] },
      ],
    };
    expect(parseStatusUpdates(payload).map((u) => u.providerMessageId)).toEqual(['a', 'b', 'c']);
  });

  it('counts inbound messages and does not mistake them for statuses', () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: 'm1' }, { id: 'm2' }] } }] }] };
    expect(parseInboundMessageCount(payload)).toBe(2);
    expect(parseStatusUpdates(payload)).toEqual([]);
  });
});

describe('status progression', () => {
  // Meta does not guarantee ordering, so the rank is what stops a late
  // 'sent' from overwriting a 'read'.
  it('ranks sent below delivered below read', () => {
    expect(statusRank('sent')).toBeLessThan(statusRank('delivered'));
    expect(statusRank('delivered')).toBeLessThan(statusRank('read'));
  });

  // A non-delivery report must beat the optimistic 'sent' we wrote when
  // Meta accepted the message -- otherwise the failure is lost, which is
  // the exact blindness this webhook exists to fix.
  it('ranks undelivered above sent', () => {
    expect(statusRank('sent')).toBeLessThan(statusRank('undelivered'));
  });

  // ...but must not beat positive evidence of arrival. A 'read' means
  // the customer opened it; no later failure callback can unmake that.
  it('ranks undelivered below delivered and read', () => {
    expect(statusRank('undelivered')).toBeLessThan(statusRank('delivered'));
    expect(statusRank('undelivered')).toBeLessThan(statusRank('read'));
  });

  // 'failed' is our own send-rejection, written when there is no message
  // id at all, so no callback can ever match such a row.
  it('ranks our own send-failure below everything', () => {
    for (const s of ['sent', 'undelivered', 'delivered', 'read'] as const) {
      expect(statusRank('failed')).toBeLessThan(statusRank(s));
    }
  });
});

describe('Meta timestamps', () => {
  // Without these, "messages are slow" can only be measured from when the
  // callback reached us, which hides whether the delay is Meta accepting
  // the message or the handset being unreachable.
  it('keeps the timestamp Meta reports for each status', () => {
    const [u] = parseStatusUpdates(
      statusPayload([{ id: 'wamid.A', status: 'delivered', timestamp: '1791500000' }]),
    );
    expect(u.timestamp).toBe(1791500000);
  });

  it('omits an absent or nonsensical timestamp rather than inventing one', () => {
    for (const ts of [undefined, '', 'soon', '0', '-5']) {
      const [u] = parseStatusUpdates(
        statusPayload([{ id: 'wamid.A', status: 'sent', ...(ts === undefined ? {} : { timestamp: ts }) }]),
      );
      expect(u.timestamp).toBeUndefined();
    }
  });
});
