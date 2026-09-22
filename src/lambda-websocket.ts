import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { loadSecretsIntoEnv } from './lib/awsSecrets';
import { ORDER_ROOM, RESTAURANT_ROOM, isAuthorizedForRestaurantRoom, type Destination } from './realtime/roomAuth';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTION_TTL_SECONDS = 6 * 60 * 60; // safety net for connections that never sent $disconnect

function table(): string {
  return process.env.WS_CONNECTIONS_TABLE!;
}

export const connectHandler: APIGatewayProxyWebsocketHandlerV2 = async () => {
  return { statusCode: 200, body: 'connected' };
};

export const disconnectHandler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  await ddb.send(
    new DeleteCommand({ TableName: table(), Key: { connectionId: event.requestContext.connectionId } }),
  );
  return { statusCode: 200, body: 'disconnected' };
};

export const defaultHandler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  await loadSecretsIntoEnv();

  const connectionId = event.requestContext.connectionId;
  const management = new ApiGatewayManagementApiClient({
    endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`,
  });

  const reply = (payload: Record<string, unknown>) =>
    management.send(
      new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(payload)) }),
    );

  let msg: { type?: string; room?: string; token?: string };
  try {
    msg = JSON.parse(event.body ?? '{}');
  } catch {
    await reply({ type: 'error', message: 'invalid json' });
    return { statusCode: 200, body: 'ok' };
  }

  if (msg.type !== 'join' || typeof msg.room !== 'string') {
    await reply({ type: 'error', message: 'expected {type: "join", room: "..."}' });
    return { statusCode: 200, body: 'ok' };
  }

  if (ORDER_ROOM.test(msg.room)) {
    await joinRoom(connectionId!, msg.room);
    await reply({ type: 'joined', room: msg.room });
    return { statusCode: 200, body: 'ok' };
  }

  const restaurantMatch = msg.room.match(RESTAURANT_ROOM);
  if (restaurantMatch) {
    const [, restaurantId, destination] = restaurantMatch;
    if (!isAuthorizedForRestaurantRoom(msg.token, restaurantId, destination as Destination)) {
      await reply({ type: 'error', message: 'not authorized for this room' });
      return { statusCode: 200, body: 'ok' };
    }
    await joinRoom(connectionId!, msg.room);
    await reply({ type: 'joined', room: msg.room });
    return { statusCode: 200, body: 'ok' };
  }

  await reply({ type: 'error', message: 'unrecognized room' });
  return { statusCode: 200, body: 'ok' };
};

async function joinRoom(connectionId: string, room: string): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: table(),
      Item: {
        connectionId,
        room,
        ttl: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
      },
    }),
  );
}
