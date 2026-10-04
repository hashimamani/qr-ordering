import { query } from '../../db/pool';
import type { NotificationChannel, NotificationStatus, NotificationTrigger } from './notifications.types';

export async function insertNotificationLog(entry: {
  orderId: string;
  channel: NotificationChannel;
  trigger: NotificationTrigger;
  status: Extract<NotificationStatus, 'sent' | 'failed'>;
  sentAt: Date | null;
  providerResponse: string;
  providerMessageId?: string;
}): Promise<void> {
  await query(
    `INSERT INTO notification_log (order_id, channel, trigger, sent_at, status, provider_response, provider_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.orderId,
      entry.channel,
      entry.trigger,
      entry.sentAt,
      entry.status,
      entry.providerResponse,
      entry.providerMessageId ?? null,
    ],
  );
}

/**
 * Applies a delivery-status callback to the row we logged at send time.
 *
 * The progression rule lives in SQL, not in the caller, because Meta can
 * deliver callbacks concurrently and out of order: two Lambda
 * invocations handling 'delivered' and 'read' for the same message would
 * otherwise read-then-write and the slower one would win, regardless of
 * which status is actually newer. Deciding it inside a single UPDATE
 * makes the rule hold under concurrency.
 *
 * Ranks come from whatsappWebhook.statusRank and must match the CASE
 * below: sent(1) < undelivered(2) < delivered(3) < read(4).
 *
 * Returns false when nothing matched -- an unknown wamid, which is
 * expected and harmless: Meta also reports on messages we did not send
 * through this path.
 */
export async function applyDeliveryStatus(update: {
  providerMessageId: string;
  status: NotificationStatus;
  rank: number;
  detail?: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE notification_log
        SET status = $2::notification_status,
            status_updated_at = now(),
            provider_response = COALESCE($4, provider_response)
      WHERE provider_message_id = $1
        AND CASE status
              WHEN 'sent' THEN 1
              WHEN 'undelivered' THEN 2
              WHEN 'delivered' THEN 3
              WHEN 'read' THEN 4
              ELSE 0
            END < $3::int`,
    [update.providerMessageId, update.status, update.rank, update.detail ?? null],
  );
  return (result.rowCount ?? 0) > 0;
}
