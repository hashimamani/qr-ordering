import { query } from '../../db/pool';
import type { NotificationChannel, NotificationTrigger } from './notifications.types';

export async function insertNotificationLog(entry: {
  orderId: string;
  channel: NotificationChannel;
  trigger: NotificationTrigger;
  status: 'sent' | 'failed';
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
