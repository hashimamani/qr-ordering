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
      const { success } = await sendNotification(job);
      if (!success) {
        failures.push({ itemIdentifier: record.messageId });
      }
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
