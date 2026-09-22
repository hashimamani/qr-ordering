import { logger } from '../../lib/logger';
import { renderTemplate } from './notifications.templates';
import { getProviderForChannel } from './notifications.providers';
import { insertNotificationLog } from './notifications.repository';
import type { NotificationJob } from './notifications.types';

/**
 * Sends one notification attempt and always writes exactly one
 * NotificationLog row for it (success or failure) — each queue delivery
 * attempt is its own audit row, mirroring how SQS redelivery would look in
 * production. A failure here must never throw back into the caller in a
 * way that could affect order submission; the queue worker decides
 * whether to retry.
 */
export async function sendNotification(job: NotificationJob): Promise<{ success: boolean }> {
  const message = renderTemplate(job);
  const provider = getProviderForChannel(job.channel);

  let result;
  try {
    result = await provider.send(job.contactValue, message);
  } catch (err) {
    result = { success: false, providerResponse: err instanceof Error ? err.message : 'unknown error' };
  }

  try {
    await insertNotificationLog({
      orderId: job.orderId,
      channel: job.channel,
      trigger: job.trigger,
      status: result.success ? 'sent' : 'failed',
      sentAt: result.success ? new Date() : null,
      providerResponse: result.providerResponse,
    });
  } catch (err) {
    logger.error({ err, job }, 'failed to write notification_log row');
  }

  return { success: result.success };
}
