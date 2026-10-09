import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { logger } from '../lib/logger';
import {
  verifyChallenge,
  verifyWebhookSignature,
  parseStatusUpdates,
  parseInboundMessageCount,
  statusRank,
} from '../modules/notifications/whatsappWebhook';
import { applyDeliveryStatus } from '../modules/notifications/notifications.repository';

export const webhookRoutes = Router();

/**
 * Meta's delivery-status callbacks.
 *
 * Unlike every other route here this one is called by a third party, not
 * by our own frontend, which changes two things: it cannot be behind our
 * auth, and it must answer 200 almost unconditionally. Meta retries a
 * non-2xx with backoff and disables a callback URL that keeps failing,
 * so an unrecognised payload has to be shrugged off rather than treated
 * as an error. The signature check below is what makes "accept almost
 * anything" safe.
 */

/**
 * The subscription handshake, sent once when the callback URL is saved
 * in the app dashboard and again whenever it is re-verified. The
 * challenge must come back as bare text -- res.json() would wrap it in
 * quotes and Meta would reject the subscription.
 */
webhookRoutes.get('/webhooks/whatsapp', (req, res) => {
  const result = verifyChallenge(
    req.query as Record<string, unknown>,
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '',
  );
  if (!result.ok) {
    logger.warn('whatsapp webhook verification rejected');
    res.sendStatus(403);
    return;
  }
  res.type('text/plain').send(result.challenge);
});

webhookRoutes.post(
  '/webhooks/whatsapp',
  asyncHandler(async (req, res) => {
    const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
    const signature = req.header('x-hub-signature-256');

    // Refusing unsigned callbacks outright, rather than processing them
    // when no app secret happens to be configured: an endpoint that
    // accepts forged "delivered" events is worse than one that records
    // nothing, because it would bury real failures under fake successes
    // -- exactly the blindness this webhook exists to remove.
    if (!verifyWebhookSignature((req as { rawBody?: Buffer }).rawBody, signature, appSecret)) {
      logger.warn(
        { hasSignature: Boolean(signature), hasAppSecret: Boolean(appSecret) },
        'whatsapp webhook signature rejected',
      );
      res.sendStatus(401);
      return;
    }

    const updates = parseStatusUpdates(req.body);
    let matched = 0;
    // Logged per status so delivery latency can be read off the logs:
    // which status, Meta's own timestamp for it, and how far behind the
    // callback arrived. Previously only the count was recorded, so a
    // "messages are slow" report had nothing to measure against.
    for (const u of updates) {
      logger.info(
        {
          providerMessageId: u.providerMessageId,
          status: u.status,
          metaTimestamp: u.timestamp,
          callbackLagSeconds: u.timestamp ? Math.round(Date.now() / 1000 - u.timestamp) : undefined,
        },
        'whatsapp delivery status',
      );
    }
    for (const update of updates) {
      const applied = await applyDeliveryStatus({
        providerMessageId: update.providerMessageId,
        status: update.status,
        rank: statusRank(update.status),
        detail: update.detail,
      });
      if (applied) matched += 1;
      if (update.status === 'undelivered') {
        // The case the whole integration is for: Meta took the message
        // and could not get it there. Logged at warn so it is findable
        // without trawling the table.
        logger.warn(
          { providerMessageId: update.providerMessageId, detail: update.detail },
          'whatsapp message undelivered',
        );
      }
    }

    const inbound = parseInboundMessageCount(req.body);
    if (inbound > 0) {
      // Not acted on: there is no conversational flow. Noted because an
      // inbound message opens Meta's 24-hour window, the only period in
      // which non-template messages are permitted.
      logger.info({ inbound }, 'inbound whatsapp message(s) received; not handled');
    }

    if (updates.length > 0) {
      logger.info({ received: updates.length, matched }, 'whatsapp delivery statuses applied');
    }

    res.sendStatus(200);
  }),
);
