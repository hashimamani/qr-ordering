import { logger } from '../../lib/logger';
import { renderTemplate } from './notifications.templates';
import {
  renderWhatsAppTemplate,
  renderWhatsAppReceiptWithDocument,
  receiptDocumentTemplateName,
  WhatsAppTemplateError,
} from './whatsappTemplates';
import { uploadWhatsAppMedia } from './whatsappMedia';
import type { WhatsAppTemplateMessage } from './whatsappTemplates';
import { getProviderForChannel, type SendResult } from './notifications.providers';
import { insertNotificationLog } from './notifications.repository';
import type { NotificationJob } from './notifications.types';

export interface SendOutcome {
  success: boolean;
  /** True when retrying cannot possibly help — a configuration or data error, not transport. */
  permanent: boolean;
}

/**
 * Builds the WhatsApp message for a job, attaching the receipt PDF when
 * that is configured and possible.
 *
 * The attachment is attempted, never required. Rendering and uploading
 * are the two steps that can fail for reasons the customer had no part
 * in -- a pdfkit problem, a Meta hiccup, a receipt row not found -- and
 * a receipt arriving as a link is enormously better than no receipt at
 * all. So any failure here degrades to the link-only template and is
 * logged, rather than failing the send.
 *
 * Deliberately not a WhatsAppTemplateError path: that type marks
 * permanent failures the queue must not retry, and "the upload hiccuped"
 * is exactly the kind of thing a retry would fix.
 */
async function whatsAppTemplateFor(job: NotificationJob): Promise<WhatsAppTemplateMessage> {
  if (job.trigger !== 'receipt' || !receiptDocumentTemplateName()) {
    return renderWhatsAppTemplate(job);
  }

  try {
    // Imported lazily for the same reason the report exporters are: it
    // pulls in pdfkit, which should not sit on the cold-start path of a
    // worker whose other two triggers never render anything.
    const [{ findReceiptDetail }, { renderReceiptPdf }] = await Promise.all([
      import('../receipts/receipts.repository'),
      import('../receipts/receipts.pdf'),
    ]);

    const receipt = await findReceiptDetail(job.orderId);
    if (!receipt) throw new Error('no receipt row for order');

    const pdf = await renderReceiptPdf(receipt);
    const filename = `${receipt.restaurant_name} receipt.pdf`.replace(/[/\\]/g, '-');
    const mediaId = await uploadWhatsAppMedia(pdf, filename);
    return renderWhatsAppReceiptWithDocument(job, mediaId, filename);
  } catch (err) {
    logger.warn(
      { err, orderId: job.orderId },
      'could not attach receipt PDF; sending the link-only receipt instead',
    );
    return renderWhatsAppTemplate(job);
  }
}

/**
 * Sends one notification attempt and always writes exactly one
 * NotificationLog row for it (success or failure) — each queue delivery
 * attempt is its own audit row, mirroring how SQS redelivery would look in
 * production. A failure here must never throw back into the caller in a
 * way that could affect order submission; the queue worker decides
 * whether to retry.
 */
export async function sendNotification(job: NotificationJob): Promise<SendOutcome> {
  const provider = getProviderForChannel(job.channel);

  let result: SendResult;
  // Distinguishes "try again later" from "this will never work". A missing
  // template id or an un-mintable receipt attachment fails identically on
  // every attempt, so retrying it only multiplies the failure rows and --
  // in production -- fills the DLQ with messages that can never succeed.
  let permanent = false;
  try {
    if (job.channel === 'whatsapp') {
      // WhatsApp takes a pre-approved template, never rendered prose --
      // see NotificationProvider.sendTemplate for why. A missing template
      // id or an un-mintable receipt attachment throws here and is logged
      // as a failure: per the no-fallback decision we do not quietly
      // re-route to SMS, because the customer chose this channel.
      if (!provider.sendTemplate) {
        throw new Error(`Provider for channel "${job.channel}" cannot send templates`);
      }
      result = await provider.sendTemplate(job.contactValue, await whatsAppTemplateFor(job));
    } else {
      result = await provider.send(job.contactValue, renderTemplate(job));
    }
  } catch (err) {
    permanent = err instanceof WhatsAppTemplateError;
    const reason = permanent
      ? `whatsapp template error: ${(err as Error).message}`
      : err instanceof Error
        ? err.message
        : 'unknown error';
    result = { success: false, providerResponse: reason };
  }

  try {
    await insertNotificationLog({
      orderId: job.orderId,
      channel: job.channel,
      trigger: job.trigger,
      status: result.success ? 'sent' : 'failed',
      sentAt: result.success ? new Date() : null,
      providerResponse: result.providerResponse,
      providerMessageId: result.providerMessageId,
    });
  } catch (err) {
    logger.error({ err, job }, 'failed to write notification_log row');
  }

  // A provider may also classify its own failure (see SendResult.permanent)
  // -- e.g. Meta answering 4xx, which no amount of retrying will change.
  permanent = permanent || result.permanent === true;

  if (permanent) {
    // The durable record is the failed notification_log row above; this
    // log line is the operator-facing signal, since a permanent failure
    // deliberately never reaches the dead-letter queue.
    logger.error({ job, reason: result.providerResponse }, 'notification permanently undeliverable; not retrying');
  }

  return { success: result.success, permanent };
}
