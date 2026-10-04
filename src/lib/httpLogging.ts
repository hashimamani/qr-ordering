import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Decides the completion message pino-http logs for a request.
 *
 * pino-http's default is:
 *
 *   !req.readableAborted && res.writableEnded ? 'completed' : 'aborted'
 *
 * which is wrong under serverless-http. Its ServerlessResponse overrides
 * end() to collect the body rather than writing to a socket, so Node's
 * writableEnded never flips -- every single request in Lambda was logged
 * as "request aborted", including ones that returned 200 with a
 * responseTime. That is worse than cosmetic: it is precisely the line
 * you would grep for to find a request that really was cut off, and it
 * was firing on all of them.
 *
 * Measured across the three cases that matter:
 *
 *   serverless, completed     readableAborted=false writableEnded=false headersSent=true
 *   real server, completed    readableAborted=false writableEnded=true  headersSent=true
 *   real server, aborted      readableAborted=true  writableEnded=false headersSent=false
 *
 * headersSent separates them without needing to know which runtime we are
 * in -- it is true exactly when a response actually went out. Keeping
 * writableEnded in the test as well means a real server still reports via
 * the stricter signal when it has one.
 */
export function requestCompletionMessage(req: IncomingMessage, res: ServerResponse): string {
  const aborted = (req as IncomingMessage & { readableAborted?: boolean }).readableAborted === true;
  const responded = res.writableEnded || res.headersSent;
  return !aborted && responded ? 'request completed' : 'request aborted';
}
