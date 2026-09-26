import { broadcast as localBroadcast, closeRoom as localCloseRoom } from './socketServer';
import { dynamoBroadcast, dynamoCloseRoom } from './dynamoBroadcaster';
import { logger } from '../lib/logger';

/**
 * Environment-selected broadcast: the in-memory `ws` room map locally,
 * DynamoDB + API Gateway Management API when running as Lambda
 * (AWS_LAMBDA_FUNCTION_NAME is set by the Lambda runtime itself, not
 * something this app sets). Callers never need to know which.
 */
export async function broadcastEvent(room: string, event: Record<string, unknown>): Promise<void> {
  try {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      await dynamoBroadcast(room, event);
    } else {
      localBroadcast(room, event);
    }
  } catch (err) {
    logger.warn({ err, room }, 'broadcast failed (non-fatal)');
  }
}

/**
 * Ends every connection in `room` and releases its backing resources
 * (the DynamoDB connections-table rows and the underlying API Gateway
 * connections in production, the in-memory socket set locally). Call
 * this only after broadcasting whatever final event tells clients not
 * to reconnect -- see useRealtime's handling of `order_complete`.
 */
export async function closeRoom(room: string): Promise<void> {
  try {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      await dynamoCloseRoom(room);
    } else {
      localCloseRoom(room);
    }
  } catch (err) {
    logger.warn({ err, room }, 'closeRoom failed (non-fatal)');
  }
}
