import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from '../../lib/logger';
import { sendNotification } from './notifications.service';
import type { NotificationJob } from './notifications.types';

export interface NotificationQueue {
  enqueue(job: NotificationJob): Promise<void>;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 5_000, 15_000];

/**
 * Local/dev stand-in for SQS: decouples notification sending from the HTTP
 * request via setImmediate, and retries a failed send a few times with
 * backoff before giving up — approximating SQS's redelivery + DLQ
 * behaviour without needing real AWS infra to run locally.
 */
class InMemoryNotificationQueue implements NotificationQueue {
  async enqueue(job: NotificationJob): Promise<void> {
    setImmediate(() => {
      void this.processWithRetry(job, 0);
    });
  }

  private async processWithRetry(job: NotificationJob, attempt: number): Promise<void> {
    const { success } = await sendNotification(job);
    if (success || attempt >= MAX_ATTEMPTS - 1) {
      if (!success) {
        logger.error({ job, attempt: attempt + 1 }, 'notification failed after max attempts');
      }
      return;
    }
    const delay = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    setTimeout(() => {
      void this.processWithRetry(job, attempt + 1);
    }, delay);
  }
}

/**
 * Production queue: enqueues onto SQS. A separate Lambda (see
 * infra/lambda/notification-worker) is subscribed to this queue and calls
 * the same sendNotification() service — retry/backoff and the dead-letter
 * queue are handled by SQS's own redrive policy, configured in Terraform.
 */
class SqsNotificationQueue implements NotificationQueue {
  private readonly client = new SQSClient({});

  constructor(private readonly queueUrl: string) {}

  async enqueue(job: NotificationJob): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(job),
      }),
    );
  }
}

let singleton: NotificationQueue | undefined;

export function getNotificationQueue(): NotificationQueue {
  if (!singleton) {
    const queueUrl = process.env.SQS_NOTIFICATIONS_QUEUE_URL;
    singleton = queueUrl ? new SqsNotificationQueue(queueUrl) : new InMemoryNotificationQueue();
  }
  return singleton;
}
