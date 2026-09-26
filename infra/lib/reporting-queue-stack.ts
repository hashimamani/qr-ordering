import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * Decouples the reporting fact tables from order placement/payment --
 * mirrors QueueStack (queue-stack.ts) exactly, except FIFO. FIFO (not
 * standard, unlike NotificationsQueue) with MessageGroupId set to the
 * order id guarantees every event for the same order is delivered to the
 * worker in send order: order_waiter_assigned/order_paid are UPDATEs
 * keyed on order_id, and would silently no-op (permanently losing that
 * fact) if ever processed before the order_placed INSERT that creates the
 * row -- a standard queue gives no such guarantee. contentBasedDeduplication
 * avoids needing to hand-manage dedup ids in application code.
 */
export class ReportingQueueStack extends Stack {
  readonly reportingQueue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.deadLetterQueue = new sqs.Queue(this, 'ReportingEventsDeadLetterQueue', {
      fifo: true,
      retentionPeriod: Duration.days(14),
    });

    this.reportingQueue = new sqs.Queue(this, 'ReportingEventsQueue', {
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: Duration.seconds(30),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 5 },
    });
  }
}
