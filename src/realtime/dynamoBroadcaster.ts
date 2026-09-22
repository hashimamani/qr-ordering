import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { logger } from '../lib/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Production broadcast path: looks up every connectionId subscribed to
 * `room` via the connections table's room-index GSI, then pushes to each
 * over the API Gateway Management API. A 410 (Gone) means the client
 * disconnected without a clean $disconnect firing -- prune it rather than
 * treating it as an error.
 */
export async function dynamoBroadcast(room: string, event: Record<string, unknown>): Promise<void> {
  const table = process.env.WS_CONNECTIONS_TABLE;
  const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT;
  if (!table || !endpoint) return;

  const management = new ApiGatewayManagementApiClient({ endpoint });
  const result = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'room-index',
      KeyConditionExpression: 'room = :room',
      ExpressionAttributeValues: { ':room': room },
    }),
  );

  const payload = Buffer.from(JSON.stringify(event));
  await Promise.all(
    (result.Items ?? []).map(async (item) => {
      try {
        await management.send(new PostToConnectionCommand({ ConnectionId: item.connectionId, Data: payload }));
      } catch (err) {
        const statusCode = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (statusCode === 410) {
          await ddb.send(new DeleteCommand({ TableName: table, Key: { connectionId: item.connectionId } }));
        } else {
          logger.warn({ err, connectionId: item.connectionId }, 'failed to post to websocket connection');
        }
      }
    }),
  );
}
