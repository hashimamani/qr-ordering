import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { requestCompletionMessage } from './httpLogging';

/**
 * The three shapes measured against real objects -- serverless-http's
 * ServerlessResponse, a completed node server response, and one whose
 * client hung up mid-flight. Pinned here so the Lambda case cannot
 * regress back to logging every request as aborted, and so the genuine
 * abort keeps being reported.
 */
function reqRes(readableAborted: boolean, writableEnded: boolean, headersSent: boolean) {
  return [
    { readableAborted } as unknown as IncomingMessage,
    { writableEnded, headersSent } as unknown as ServerResponse,
  ] as const;
}

describe('request completion message', () => {
  // serverless-http never flips writableEnded; headersSent is what says
  // a response actually went out.
  it('reports a completed Lambda response as completed', () => {
    expect(requestCompletionMessage(...reqRes(false, false, true))).toBe('request completed');
  });

  it('reports a completed node-server response as completed', () => {
    expect(requestCompletionMessage(...reqRes(false, true, true))).toBe('request completed');
  });

  // The case the message is actually for -- it has to survive the fix.
  it('still reports a genuinely aborted request as aborted', () => {
    expect(requestCompletionMessage(...reqRes(true, false, false))).toBe('request aborted');
  });

  it('reports an abort even if headers had already gone out', () => {
    expect(requestCompletionMessage(...reqRes(true, false, true))).toBe('request aborted');
  });

  // Nothing sent and nothing ended: not a completed request.
  it('reports a response that never went out as aborted', () => {
    expect(requestCompletionMessage(...reqRes(false, false, false))).toBe('request aborted');
  });
});
