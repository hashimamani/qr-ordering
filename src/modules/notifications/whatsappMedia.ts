import { logger } from '../../lib/logger';

/**
 * Uploads bytes to Meta and returns a media id usable as a template's
 * DOCUMENT header.
 *
 * This is the whole reason attaching the receipt is viable again. The
 * alternative Meta offers is handing it a `link` it fetches itself,
 * which for us meant minting a token that let a third party past the
 * last-4 challenge guarding the receipt -- a challenge-free URL sitting
 * in someone else's request logs, however briefly. Uploading the bytes
 * creates no URL at all, so there is nothing to leak and nothing to
 * expire.
 *
 * Meta keeps an uploaded media id for 30 days. We use it within seconds
 * and never store it: re-rendering the PDF is cheap and deterministic,
 * whereas a stored id is a second source of truth that can go stale.
 */

export class WhatsAppMediaError extends Error {}

export function receiptAttachmentsEnabled(): boolean {
  return Boolean(process.env.WHATSAPP_TEMPLATE_RECEIPT_DOC);
}

export async function uploadWhatsAppMedia(
  bytes: Buffer,
  filename: string,
  contentType = 'application/pdf',
): Promise<string> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const version = process.env.WHATSAPP_API_VERSION || 'v25.0';
  if (!phoneNumberId || !token) {
    throw new WhatsAppMediaError('WhatsApp media upload is not configured');
  }

  const form = new FormData();
  // messaging_product is required and easy to forget -- Meta rejects the
  // upload with a generic error if it is absent.
  form.append('messaging_product', 'whatsapp');
  form.append('type', contentType);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new WhatsAppMediaError(`meta media upload ${response.status}: ${body.slice(0, 300)}`);
  }

  let id: unknown;
  try {
    id = (JSON.parse(body) as { id?: unknown }).id;
  } catch {
    throw new WhatsAppMediaError(`meta media upload returned unparseable body: ${body.slice(0, 200)}`);
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new WhatsAppMediaError(`meta media upload returned no id: ${body.slice(0, 200)}`);
  }

  logger.info({ mediaId: id, bytes: bytes.length, filename }, 'uploaded whatsapp media');
  return id;
}
