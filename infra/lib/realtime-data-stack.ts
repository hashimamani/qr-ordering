import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

/**
 * Connection tracking for the API Gateway WebSocket API. Lambda is
 * stateless, so broadcasting to "everyone subscribed to this room" needs
 * *some* store mapping connectionId -> room -- this is that store.
 *
 * DynamoDB rather than Postgres deliberately: it's reachable from Lambda
 * without a VPC attachment at all (see README's NAT Gateway writeup), it's
 * pay-per-request, and connection records are inherently short-lived,
 * high-churn, key-value data with no relational structure -- a genuinely
 * good fit unlike the rest of this app's data, which stayed in Postgres.
 *
 * TTL provides a safety net for connections that never got a clean
 * $disconnect (a killed device, a dropped network) -- lambda-websocket.ts
 * sets a 6h expiry on every join.
 */
export class RealtimeDataStack extends Stack {
  readonly connectionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.connectionsTable = new dynamodb.Table(this, 'WsConnections', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY, // purely ephemeral connection state, safe to lose
    });

    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'room-index',
      partitionKey: { name: 'room', type: dynamodb.AttributeType.STRING },
    });
  }
}
