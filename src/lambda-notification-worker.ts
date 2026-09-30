import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { loadSecretsIntoEnv } from './lib/awsSecrets';
import type { NotificationJob } from './modules/notifications/notifications.types';

/**
 * SQS-triggered: one invocation per batch. Returning batchItemFailures
 * (partial batch response) tells SQS to redrive only the failed messages
 * -- retry/backoff and the eventual dead-letter queue are handled by SQS's
 * own redrive policy (configured in infra/), not application code, unlike
 * the in-process queue's manual retry loop used in local dev.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadSecretsIntoEnv();
  const { sendNotification } = await import('./modules/notifications/notifications.service');

  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const job = JSON.parse(record.body) as NotificationJob;
      const { success, permanent } = await sendNotification(job);
      // A permanent failure is acknowledged rather than redriven: SQS
      // would retry it five times and then dead-letter a message that
      // cannot ever succeed. The failure is already recorded in
      // notification_log and logged at error level by sendNotification.
      if (!success && !permanent) {
        failures.push({ itemIdentifier: record.messageId });
      }
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
