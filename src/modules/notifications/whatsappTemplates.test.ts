import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderWhatsAppTemplate,
  templateIdFor,
  missingTemplateIds,
  WhatsAppTemplateError,
} from './whatsappTemplates';
import type { NotificationJob, NotificationTrigger } from './notifications.types';

const TRIGGERS: NotificationTrigger[] = ['order_received', 'order_ready', 'receipt'];

const ENV_KEYS = [
  'WHATSAPP_TEMPLATE_ID_ORDER_RECEIVED',
  'WHATSAPP_TEMPLATE_ID_ORDER_READY',
  'WHATSAPP_TEMPLATE_ID_RECEIPT',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.WHATSAPP_TEMPLATE_ID_ORDER_RECEIVED = 'tpl-received';
  process.env.WHATSAPP_TEMPLATE_ID_ORDER_READY = 'tpl-ready';
  process.env.WHATSAPP_TEMPLATE_ID_RECEIPT = 'tpl-receipt';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key]!;
  }
});

function job(trigger: NotificationTrigger, extra: Partial<NotificationJob['templateData']> = {}): NotificationJob {
  return {
    orderId: '1',
    channel: 'whatsapp',
    contactValue: '+254712345678',
    trigger,
    templateData: {
      restaurantName: 'Amani Grill',
      trackingUrl: 'https://tab.example/track/abc',
      ...extra,
    },
  };
}

const receiptJob = () =>
  job('receipt', {
    receiptUrl: 'https://tab.example/receipt/xyz',
    receiptMediaUrl: 'https://tab.example/media/one-time',
  });

describe('template id configuration', () => {
  it('resolves an id per trigger', () => {
    expect(templateIdFor('order_received')).toBe('tpl-received');
    expect(templateIdFor('order_ready')).toBe('tpl-ready');
    expect(templateIdFor('receipt')).toBe('tpl-receipt');
  });

  it('reports which ids are missing, so the gap is visible at startup', () => {
    delete process.env.WHATSAPP_TEMPLATE_ID_RECEIPT;
    expect(missingTemplateIds()).toEqual(['receipt']);
  });

  it('treats an empty string as missing rather than sending against ""', () => {
    process.env.WHATSAPP_TEMPLATE_ID_RECEIPT = '';
    expect(templateIdFor('receipt')).toBeUndefined();
  });

  it('refuses to render without a configured id', () => {
    delete process.env.WHATSAPP_TEMPLATE_ID_ORDER_READY;
    expect(() => renderWhatsAppTemplate(job('order_ready'))).toThrow(WhatsAppTemplateError);
  });
});

// The tests that matter most. A transposed parameter sends successfully
// and reads as nonsense to a real customer -- no error, no log, nothing
// to notice. Asserting position by position is the only way to catch it.
describe('parameter order', () => {
  it('order_received: restaurant in the header, tracking URL in the body', () => {
    const t = renderWhatsAppTemplate(job('order_received'));
    expect(t.templateId).toBe('tpl-received');
    expect(t.headerValue).toBe('Amani Grill');
    expect(t.bodyValues).toEqual(['https://tab.example/track/abc']);
  });

  it('order_ready: restaurant in the header, tracking URL in the body', () => {
    const t = renderWhatsAppTemplate(job('order_ready'));
    expect(t.headerValue).toBe('Amani Grill');
    expect(t.bodyValues).toEqual(['https://tab.example/track/abc']);
  });

  it('receipt: media URL in the header, restaurant then receipt URL in the body', () => {
    const t = renderWhatsAppTemplate(receiptJob());
    expect(t.headerValue).toBe('https://tab.example/media/one-time');
    expect(t.bodyValues).toEqual(['Amani Grill', 'https://tab.example/receipt/xyz']);
  });

  // The two URLs are both on the job and are easy to confuse. Sending the
  // tracking link as the receipt link would look entirely plausible.
  it('receipt never puts the tracking URL where the receipt URL belongs', () => {
    const t = renderWhatsAppTemplate(receiptJob());
    expect(t.bodyValues).not.toContain('https://tab.example/track/abc');
    expect(t.headerValue).not.toBe('https://tab.example/track/abc');
  });

  it('never emits a null or undefined value, which renders as a literal gap', () => {
    for (const t of [renderWhatsAppTemplate(job('order_received')), renderWhatsAppTemplate(receiptJob())]) {
      expect(typeof t.headerValue).toBe('string');
      expect(t.headerValue.length).toBeGreaterThan(0);
      for (const value of t.bodyValues) expect(typeof value).toBe('string');
    }
  });
});

describe('receipt document header', () => {
  // A DOCUMENT header has nothing to fall back to -- headerValue is
  // required by AT and can only be the media URL. Failing loudly beats
  // sending a "your receipt is attached" message with no attachment.
  it('refuses to send a receipt with no media URL', () => {
    expect(() =>
      renderWhatsAppTemplate(job('receipt', { receiptUrl: 'https://tab.example/receipt/xyz' })),
    ).toThrow(WhatsAppTemplateError);
  });

  it('does not require a media URL for the non-receipt templates', () => {
    for (const trigger of TRIGGERS.filter((t) => t !== 'receipt')) {
      expect(() => renderWhatsAppTemplate(job(trigger))).not.toThrow();
    }
  });
});
