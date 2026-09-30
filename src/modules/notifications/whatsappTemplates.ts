import type { NotificationJob, NotificationTrigger } from './notifications.types';

/**
 * Maps our notification triggers onto the WhatsApp templates registered
 * with Africa's Talking, and — critically — onto the ORDER of their
 * positional parameters.
 *
 * This is its own module because template parameters are positional
 * (`{{1}}`, `{{2}}`), so getting the order wrong is completely silent:
 * nothing throws, the send succeeds, and the customer receives
 * "Thanks for ordering at https://..." with the link where the
 * restaurant name should be. Keeping names, IDs and parameter order in
 * one reviewable place is the only real defence.
 *
 * Shape follows Africa's Talking' own send contract
 * (node_modules/africastalking/lib/whatsapp.js), not Meta's generic one:
 *
 *   body: { templateId, headerValue, bodyValues[] }
 *
 * Two consequences worth knowing:
 *  - Sends are keyed on a templateId that AT assigns when the template is
 *    registered, NOT the human name. IDs differ per account, so they are
 *    configuration (see templateIdFor) rather than constants.
 *  - `headerValue` is a single required string. For a TEXT header it is
 *    the header's parameter; for a DOCUMENT header it is the media URL.
 *    There is no way to send a template with no header value at all,
 *    which is why every template below defines one.
 */

export interface WhatsAppTemplateMessage {
  templateId: string;
  /** TEXT header parameter, or the document URL for a DOCUMENT header. */
  headerValue: string;
  /** Positional — index 0 fills {{1}} in the BODY, index 1 fills {{2}}. */
  bodyValues: string[];
}

/**
 * The env var holding each template's AT-assigned id. Absent ids are what
 * keeps this path dormant until the templates are actually approved:
 * getProviderForChannel falls back to the console provider, exactly as
 * the email path does today without an SES address.
 */
const TEMPLATE_ID_ENV: Record<NotificationTrigger, string> = {
  order_received: 'WHATSAPP_TEMPLATE_ID_ORDER_RECEIVED',
  order_ready: 'WHATSAPP_TEMPLATE_ID_ORDER_READY',
  receipt: 'WHATSAPP_TEMPLATE_ID_RECEIPT',
};

export function templateIdFor(trigger: NotificationTrigger): string | undefined {
  return process.env[TEMPLATE_ID_ENV[trigger]] || undefined;
}

export function missingTemplateIds(): NotificationTrigger[] {
  return (Object.keys(TEMPLATE_ID_ENV) as NotificationTrigger[]).filter((t) => !templateIdFor(t));
}

export class WhatsAppTemplateError extends Error {}

/**
 * Registered with Africa's Talking as UTILITY templates. The text here
 * must match what was submitted, because the placeholder positions are
 * the contract:
 *
 *   tab_order_received  HEADER(TEXT) {{1}} = restaurant
 *                       BODY "Thanks for your order! Track it here: {{1}}"
 *   tab_order_ready     HEADER(TEXT) {{1}} = restaurant
 *                       BODY "Your order is ready. Details: {{1}}"
 *   tab_receipt         HEADER(DOCUMENT) = the receipt PDF
 *                       BODY "Thanks for visiting {{1}}! Your receipt is
 *                             attached. You can also view it here: {{2}}"
 */
export function renderWhatsAppTemplate(job: NotificationJob): WhatsAppTemplateMessage {
  const templateId = templateIdFor(job.trigger);
  if (!templateId) {
    throw new WhatsAppTemplateError(`No WhatsApp template id configured for "${job.trigger}"`);
  }

  const { restaurantName, trackingUrl, receiptUrl, receiptMediaUrl } = job.templateData;

  if (job.trigger === 'receipt') {
    // The DOCUMENT header IS the attachment, so without a media URL there
    // is no valid send -- AT requires headerValue, and a document header
    // can't be filled with anything else. Failing loudly here is right:
    // per the no-fallback decision this becomes a logged failure rather
    // than quietly degrading to a receipt with no receipt in it.
    if (!receiptMediaUrl) {
      throw new WhatsAppTemplateError('Receipt template requires a media URL for its document header');
    }
    return {
      templateId,
      headerValue: receiptMediaUrl,
      bodyValues: [restaurantName, receiptUrl ?? ''],
    };
  }

  return {
    templateId,
    headerValue: restaurantName,
    bodyValues: [trackingUrl],
  };
}
