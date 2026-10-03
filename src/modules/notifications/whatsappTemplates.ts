import type { NotificationJob, NotificationTrigger } from './notifications.types';

/**
 * Maps our notification triggers onto the WhatsApp templates approved on
 * the WABA, and — critically — onto the ORDER of their positional
 * parameters.
 *
 * This is its own module because template parameters are positional, so
 * getting the order wrong is completely silent: nothing throws, the send
 * succeeds, and the customer receives "Thanks for ordering at https://..."
 * with the link where the restaurant name should be. Keeping names and
 * parameter order in one reviewable place is the only real defence.
 *
 * Shape follows Meta's Cloud API `components` model, which is what we
 * integrate against directly:
 *
 *   components: [
 *     { type: 'header', parameters: [{ type: 'document', document: {...} }] },
 *     { type: 'body',   parameters: [{ type: 'text', text: '...' }, ...] },
 *   ]
 *
 * Template *names* (not ids) are the addressable key in the Cloud API, and
 * they're per-WABA, so they stay configurable rather than hardcoded.
 */

export type TemplateHeader =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'document'; link: string; filename: string };

export interface WhatsAppTemplateMessage {
  templateName: string;
  languageCode: string;
  header: TemplateHeader;
  /** Positional — index 0 fills {{1}} in the BODY, index 1 fills {{2}}. */
  bodyParams: string[];
}

const TEMPLATE_NAME_ENV: Record<NotificationTrigger, string> = {
  order_received: 'WHATSAPP_TEMPLATE_ORDER_RECEIVED',
  order_ready: 'WHATSAPP_TEMPLATE_ORDER_READY',
  receipt: 'WHATSAPP_TEMPLATE_RECEIPT',
};

export function templateNameFor(trigger: NotificationTrigger): string | undefined {
  return process.env[TEMPLATE_NAME_ENV[trigger]] || undefined;
}

export function missingTemplateNames(): NotificationTrigger[] {
  return (Object.keys(TEMPLATE_NAME_ENV) as NotificationTrigger[]).filter((t) => !templateNameFor(t));
}

/** Meta requires an explicit language; it must match the approved template's. */
export function templateLanguage(): string {
  return process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
}

export class WhatsAppTemplateError extends Error {}

/**
 * Registered on the WABA as UTILITY templates. The text below is exactly
 * what was submitted, because the placeholder positions are the contract:
 *
 *   order_received  BODY "Thanks for ordering at {{1}}! Track your order
 *                         here: {{2}} We will message you again when it
 *                         is ready."
 *   order_ready     BODY "Your order at {{1}} is ready. Details: {{2}}
 *                         Enjoy your meal!"
 *   receipt         HEADER(DOCUMENT) = the receipt PDF
 *                   BODY "Thanks for visiting {{1}}! Your receipt is
 *                         attached. You can also view it here: {{2}}
 *                         We hope to see you again soon."
 *
 * Each ends in static text rather than a variable, and that is not a
 * stylistic choice: Meta rejects a template whose body starts or ends
 * with a placeholder ("Leading or Trailing Params Not Allowed",
 * error_subcode 2388299). The first drafts here ended with the URL and
 * were refused outright, so any future template needs a static closer.
 */
export function renderWhatsAppTemplate(job: NotificationJob): WhatsAppTemplateMessage {
  const templateName = templateNameFor(job.trigger);
  if (!templateName) {
    throw new WhatsAppTemplateError(`No WhatsApp template name configured for "${job.trigger}"`);
  }

  const { restaurantName, trackingUrl, receiptUrl, receiptMediaUrl } = job.templateData;
  const languageCode = templateLanguage();

  if (job.trigger === 'receipt') {
    // The DOCUMENT header IS the attachment, so without a media URL there
    // is no valid send. Failing loudly is right: per the no-fallback
    // decision this becomes a logged failure rather than quietly
    // degrading to a "your receipt is attached" message with no receipt.
    if (!receiptMediaUrl) {
      throw new WhatsAppTemplateError('Receipt template requires a media URL for its document header');
    }
    return {
      templateName,
      languageCode,
      header: { kind: 'document', link: receiptMediaUrl, filename: 'receipt.pdf' },
      bodyParams: [restaurantName, receiptUrl ?? ''],
    };
  }

  return {
    templateName,
    languageCode,
    header: { kind: 'none' },
    bodyParams: [restaurantName, trackingUrl],
  };
}

/**
 * Builds the Cloud API `components` array. Separated from the provider so
 * the exact JSON Meta receives can be asserted in tests without any
 * network involved — a malformed component is rejected with a generic
 * error that gives no clue which parameter was wrong.
 */
export function toMetaComponents(template: WhatsAppTemplateMessage): unknown[] {
  const components: unknown[] = [];

  if (template.header.kind === 'text') {
    components.push({
      type: 'header',
      parameters: [{ type: 'text', text: template.header.text }],
    });
  } else if (template.header.kind === 'document') {
    components.push({
      type: 'header',
      parameters: [
        { type: 'document', document: { link: template.header.link, filename: template.header.filename } },
      ],
    });
  }

  if (template.bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: template.bodyParams.map((text) => ({ type: 'text', text })),
    });
  }

  return components;
}
