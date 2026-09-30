import { logger } from '../../lib/logger';
import { renderTemplate } from './notifications.templates';
import { renderWhatsAppTemplate, WhatsAppTemplateError } from './whatsappTemplates';
import { getProviderForChannel, type SendResult } from './notifications.providers';
import { insertNotificationLog } from './notifications.repository';
import type { NotificationJob } from './notifications.types';

export interface SendOutcome {
  success: boolean;
  /** True when retrying cannot possibly help — a configuration or data error, not transport. */
  permanent: boolean;
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
      result = await provider.sendTemplate(job.contactValue, renderWhatsAppTemplate(job));
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

  if (permanent) {
    // The durable record is the failed notification_log row above; this
    // log line is the operator-facing signal, since a permanent failure
    // deliberately never reaches the dead-letter queue.
    logger.error({ job, reason: result.providerResponse }, 'notification permanently undeliverable; not retrying');
  }

  return { success: result.success, permanent };
}
