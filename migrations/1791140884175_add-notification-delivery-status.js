/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Records what actually happened to a message, not just that we handed
 * it over.
 *
 * Today notification_log.status is written once, at send time, and 'sent'
 * only ever meant "the provider accepted this". That is precisely the
 * distinction that made the original SMS problem invisible: Africa's
 * Talking accepted messages that promotional filters then dropped, and
 * nothing downstream ever disagreed with the 'sent' row. Meta reports
 * delivery asynchronously over a webhook, so for the first time we can
 * tell accepted from arrived.
 *
 * 'undelivered' is kept distinct from 'failed': 'failed' means our send
 * was rejected (bad template, bad token, our bug), 'undelivered' means
 * Meta accepted it and could not deliver it (number not on WhatsApp,
 * handset unreachable, user blocked the business). They need different
 * responses -- one is ours to fix, the other is a reason to offer the
 * customer another channel -- so collapsing them would lose the only
 * signal that distinguishes them.
 *
 * status_updated_at is separate from sent_at because sent_at must keep
 * meaning "when we sent it" for the receipt and support paths; this is
 * when we last heard about it.
 *
 * The index on provider_message_id is not optional: every status
 * callback arrives keyed by wamid and nothing else, so without it each
 * one is a sequential scan of the whole log.
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'delivered';`);
  pgm.sql(`ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'read';`);
  pgm.sql(`ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'undelivered';`);

  pgm.sql(`
    ALTER TABLE notification_log ADD COLUMN status_updated_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_notification_log_provider_message_id
      ON notification_log(provider_message_id)
      WHERE provider_message_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  // The enum values stay: Postgres has no DROP VALUE, and rebuilding
  // notification_status would mean rewriting notification_log. Unused
  // members are harmless.
  pgm.sql(`
    DROP INDEX IF EXISTS idx_notification_log_provider_message_id;
    ALTER TABLE notification_log DROP COLUMN status_updated_at;
  `);
};
