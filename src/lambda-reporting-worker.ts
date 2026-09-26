import type { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { loadSecretsIntoEnv } from './lib/awsSecrets';
import type { ReportingEvent } from './modules/reports/events/reportingEvents.types';

/**
 * SQS-triggered: one invocation per batch. Mirrors lambda-notification-
 * worker.ts exactly -- returning batchItemFailures (partial batch
 * response) tells SQS to redrive only the failed messages; retry/backoff
 * and the eventual dead-letter queue are handled by SQS's own redrive
 * policy (configured in infra/), not application code.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadSecretsIntoEnv();
  const { processReportingEvent } = await import('./modules/reports/events/reportingEvents.worker');

  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const reportingEvent = JSON.parse(record.body) as ReportingEvent;
      await processReportingEvent(reportingEvent);
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
