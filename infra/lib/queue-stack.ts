import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * Decouples order submission from notification sending -- a slow/failed
 * Africa's Talking or SES call never blocks the HTTP response, and SQS's
 * own redrive policy gives retry semantics for free (see
 * lambda-notification-worker.ts's partial-batch-response handling).
 */
export class QueueStack extends Stack {
  readonly notificationsQueue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.deadLetterQueue = new sqs.Queue(this, 'NotificationsDeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.notificationsQueue = new sqs.Queue(this, 'NotificationsQueue', {
      visibilityTimeout: Duration.seconds(30),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 5 },
    });
  }
}
