import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderWhatsAppReceiptWithDocument,
  renderWhatsAppTemplate,
  toMetaComponents,
  templateNameFor,
  missingTemplateNames,
  WhatsAppTemplateError,
} from './whatsappTemplates';
import type { NotificationJob, NotificationTrigger } from './notifications.types';

const TRIGGERS: NotificationTrigger[] = ['order_received', 'order_ready', 'receipt'];

const ENV_KEYS = [
  'WHATSAPP_TEMPLATE_ORDER_RECEIVED',
  'WHATSAPP_TEMPLATE_ORDER_READY',
  'WHATSAPP_TEMPLATE_RECEIPT',
  'WHATSAPP_TEMPLATE_LANGUAGE',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.WHATSAPP_TEMPLATE_ORDER_RECEIVED = 'tab_order_received';
  process.env.WHATSAPP_TEMPLATE_ORDER_READY = 'tab_order_ready';
  process.env.WHATSAPP_TEMPLATE_RECEIPT = 'tab_receipt_link';
  delete process.env.WHATSAPP_TEMPLATE_LANGUAGE;
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
  });

describe('template configuration', () => {
  it('resolves a name per trigger', () => {
    expect(templateNameFor('order_received')).toBe('tab_order_received');
    expect(templateNameFor('receipt')).toBe('tab_receipt_link');
  });

  it('reports missing names so the gap is visible', () => {
    delete process.env.WHATSAPP_TEMPLATE_RECEIPT;
    expect(missingTemplateNames()).toEqual(['receipt']);
  });

  it('treats an empty string as missing rather than sending against ""', () => {
    process.env.WHATSAPP_TEMPLATE_RECEIPT = '';
    expect(templateNameFor('receipt')).toBeUndefined();
  });

  it('refuses to render without a configured name', () => {
    delete process.env.WHATSAPP_TEMPLATE_ORDER_READY;
    expect(() => renderWhatsAppTemplate(job('order_ready'))).toThrow(WhatsAppTemplateError);
  });

  it('defaults the language but lets it be overridden to match the approved template', () => {
    expect(renderWhatsAppTemplate(job('order_received')).languageCode).toBe('en_US');
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'en';
    expect(renderWhatsAppTemplate(job('order_received')).languageCode).toBe('en');
  });
});

// The tests that matter most. A transposed parameter sends successfully
// and reads as nonsense to a real customer -- no error, no log, nothing
// to notice. Asserting position by position is the only way to catch it.
describe('parameter order', () => {
  it('order_received: restaurant then tracking URL', () => {
    const t = renderWhatsAppTemplate(job('order_received'));
    expect(t.templateName).toBe('tab_order_received');
    expect(t.bodyParams).toEqual(['Amani Grill', 'https://tab.example/track/abc']);
    expect(t.header.kind).toBe('none');
  });

  it('order_ready: restaurant then tracking URL', () => {
    expect(renderWhatsAppTemplate(job('order_ready')).bodyParams).toEqual([
      'Amani Grill',
      'https://tab.example/track/abc',
    ]);
  });

  it('receipt: restaurant then receipt URL, carried as a link', () => {
    const t = renderWhatsAppTemplate(receiptJob());
    expect(t.bodyParams).toEqual(['Amani Grill', 'https://tab.example/receipt/xyz']);
    expect(t.header).toEqual({ kind: 'none' });
  });

  // The two URLs are both on the job and easy to confuse; sending the
  // tracking link as the receipt link would look entirely plausible.
  it('receipt never substitutes the tracking URL for the receipt URL', () => {
    const t = renderWhatsAppTemplate(receiptJob());
    expect(t.bodyParams).not.toContain('https://tab.example/track/abc');
  });

  it('never emits a non-string param, which renders as a literal gap', () => {
    for (const t of [renderWhatsAppTemplate(job('order_received')), renderWhatsAppTemplate(receiptJob())]) {
      for (const param of t.bodyParams) expect(typeof param).toBe('string');
    }
  });
});

describe('receipt link', () => {
  // Meta rejects an empty parameter, and were it accepted the customer
  // would read "download your receipt here:" followed by nothing.
  it('refuses to send a receipt with no receipt URL', () => {
    expect(() => renderWhatsAppTemplate(job('receipt', {}))).toThrow(WhatsAppTemplateError);
  });

  // Guards the decision to stop attaching the PDF: a DOCUMENT header
  // would hand a bearer-free receipt URL to Meta's fetchers, bypassing
  // the last-4 challenge that protects the document.
  it('sends no attachment, so nothing fetches the PDF on the customer behalf', () => {
    expect(renderWhatsAppTemplate(receiptJob()).header.kind).toBe('none');
  });

  it('does not require a receipt URL for non-receipt templates', () => {
    for (const trigger of TRIGGERS.filter((t) => t !== 'receipt')) {
      expect(() => renderWhatsAppTemplate(job(trigger))).not.toThrow();
    }
  });
});

// Meta rejects a malformed component with a generic error that doesn't say
// which parameter was wrong, so the exact JSON is asserted here instead.
describe('Meta component serialisation', () => {
  it('emits a body component with text parameters in order', () => {
    const components = toMetaComponents(renderWhatsAppTemplate(job('order_received')));
    expect(components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Amani Grill' },
          { type: 'text', text: 'https://tab.example/track/abc' },
        ],
      },
    ]);
  });

  // No trigger currently renders a document header, but the serialiser
  // still supports one for when attachments are revisited -- header must
  // precede body or Meta rejects the send.
  it('emits the document header before the body, as Meta expects', () => {
    const components = toMetaComponents({
      templateName: 'tab_receipt_doc',
      languageCode: 'en_US',
      header: { kind: 'document', link: 'https://tab.example/media/one-time', filename: 'receipt.pdf' },
      bodyParams: ['Amani Grill'],
    }) as { type: string }[];
    expect(components.map((c) => c.type)).toEqual(['header', 'body']);
    expect(components[0]).toEqual({
      type: 'header',
      parameters: [
        {
          type: 'document',
          document: { link: 'https://tab.example/media/one-time', filename: 'receipt.pdf' },
        },
      ],
    });
  });

  it('omits the header component entirely when there is none', () => {
    const components = toMetaComponents(renderWhatsAppTemplate(job('order_ready'))) as { type: string }[];
    expect(components.some((c) => c.type === 'header')).toBe(false);
  });
});

describe('receipt with the PDF attached', () => {
  const DOC_ENV = 'WHATSAPP_TEMPLATE_RECEIPT_DOC';

  it('references the uploaded media by id, never by URL', () => {
    process.env[DOC_ENV] = 'tab_receipt';
    const t = renderWhatsAppReceiptWithDocument(receiptJob(), '1630371501773581');
    expect(t.templateName).toBe('tab_receipt');
    expect(t.header).toEqual({
      kind: 'document_id',
      id: '1630371501773581',
      filename: 'receipt.pdf',
    });
    // The whole point of the media-id route: nothing in the outgoing
    // message is a URL that would bypass the receipt's last-4 challenge.
    expect(JSON.stringify(t.header)).not.toMatch(/https?:/);
  });

  it('keeps the same body params as the link-only template', () => {
    process.env[DOC_ENV] = 'tab_receipt';
    expect(renderWhatsAppReceiptWithDocument(receiptJob(), 'm1').bodyParams).toEqual([
      'Amani Grill',
      'https://tab.example/receipt/xyz',
    ]);
  });

  it('refuses when no document template is configured', () => {
    delete process.env[DOC_ENV];
    expect(() => renderWhatsAppReceiptWithDocument(receiptJob(), 'm1')).toThrow(WhatsAppTemplateError);
  });

  it('serialises the header as a document id for Meta, header before body', () => {
    process.env[DOC_ENV] = 'tab_receipt';
    const components = toMetaComponents(
      renderWhatsAppReceiptWithDocument(receiptJob(), 'media-123'),
    ) as { type: string }[];
    expect(components.map((c) => c.type)).toEqual(['header', 'body']);
    expect(components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { id: 'media-123', filename: 'receipt.pdf' } }],
    });
  });
});
