import { broadcast as localBroadcast } from './socketServer';
import { dynamoBroadcast } from './dynamoBroadcaster';
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
