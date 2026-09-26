import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from '../../../lib/logger';
import { processReportingEvent } from './reportingEvents.worker';
import type { ReportingEvent } from './reportingEvents.types';

export interface ReportingQueue {
  enqueue(event: ReportingEvent): Promise<void>;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 5_000, 15_000];

/**
 * Local/dev stand-in for SQS -- decouples fact-table writes from the HTTP
 * request (enqueue never awaits processing), retries a few times with
 * backoff, approximating SQS's redelivery/DLQ behaviour without needing
 * real AWS infra locally.
 *
 * Unlike InMemoryNotificationQueue (which has no ordering to preserve --
 * every notification job is independent), this queue must serialize
 * events **per order id**, mirroring the FIFO SQS queue's MessageGroupId
 * guarantee in production. Confirmed live: a naive setImmediate-per-event
 * version let order_waiter_assigned's UPDATE run before order_placed's
 * INSERT had committed (each is async and yields at its own `await`, so
 * scheduling order isn't completion order) -- the UPDATE silently matched
 * zero rows and that waiter fact was lost for good. Production doesn't
 * have this risk (SQS FIFO won't deliver a group's next message to a new
 * concurrent Lambda invocation while an earlier one from that group is
 * still in flight), but the local fallback has to build the same
 * guarantee explicitly. Different orders still process fully
 * independently/concurrently -- only same-order events are serialized.
 */
class InMemoryReportingQueue implements ReportingQueue {
  private tailsByOrder = new Map<string, Promise<void>>();

  async enqueue(event: ReportingEvent): Promise<void> {
    const previousTail = this.tailsByOrder.get(event.orderId) ?? Promise.resolve();
    const tail = previousTail.then(() => this.processWithRetry(event, 0));
    this.tailsByOrder.set(event.orderId, tail);
    // Bound the map's lifetime -- drop the entry once nothing newer for
    // this order has been chained onto it since.
    void tail.finally(() => {
      if (this.tailsByOrder.get(event.orderId) === tail) {
        this.tailsByOrder.delete(event.orderId);
      }
    });
  }

  private async processWithRetry(event: ReportingEvent, attempt: number): Promise<void> {
    try {
      await processReportingEvent(event);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS - 1) {
        logger.error({ err, event, attempt: attempt + 1 }, 'reporting event failed after max attempts');
        return;
      }
      const delay = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.processWithRetry(event, attempt + 1);
    }
  }
}

/**
 * Production queue: enqueues onto a FIFO SQS queue, MessageGroupId set to
 * the order id so every event for the same order is delivered to the
 * worker in send order -- order_waiter_assigned/order_paid are UPDATEs
 * keyed on order_id, and would silently no-op (permanently losing that
 * fact) if ever processed before the order_placed INSERT that creates the
 * row. A standard (non-FIFO) queue gives no such guarantee.
 */
class SqsReportingQueue implements ReportingQueue {
  private readonly client = new SQSClient({});

  constructor(private readonly queueUrl: string) {}

  async enqueue(event: ReportingEvent): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(event),
        MessageGroupId: event.orderId,
      }),
    );
  }
}

let singleton: ReportingQueue | undefined;

export function getReportingQueue(): ReportingQueue {
  if (!singleton) {
    const queueUrl = process.env.SQS_REPORTING_QUEUE_URL;
    singleton = queueUrl ? new SqsReportingQueue(queueUrl) : new InMemoryReportingQueue();
  }
  return singleton;
}
