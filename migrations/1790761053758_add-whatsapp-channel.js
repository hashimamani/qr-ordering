/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Adds WhatsApp as a delivery channel.
 *
 * Why: promotional-SMS blocks mean a meaningful share of customers never
 * receive their order updates or receipt at all. Order confirmations and
 * receipts are "utility" messages on WhatsApp, a category that isn't
 * subject to the marketing filtering that's eating the SMS.
 *
 * contact_channel is shared by "order".contact_channel and
 * notification_log.channel, so both gain the value from this one ALTER.
 *
 * contact_consent_at records that the customer was shown the consent
 * notice when they handed over their number. Meta requires opt-in even
 * for utility templates, and a timestamp on the order is the only way to
 * evidence it after the fact -- a boolean would tell us nothing about
 * when, and the notice's wording changes over time.
 *
 * provider_message_id closes a real support gap: when a customer says
 * "I never got it", there is currently nothing to give the provider to
 * trace the send.
 */
exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE contact_channel ADD VALUE IF NOT EXISTS 'whatsapp';`);

  pgm.sql(`
    ALTER TABLE "order" ADD COLUMN contact_consent_at TIMESTAMPTZ;
    ALTER TABLE notification_log ADD COLUMN provider_message_id TEXT;
  `);
};

exports.down = (pgm) => {
  // The enum value is deliberately not removed: Postgres has no DROP
  // VALUE, and rebuilding contact_channel would mean rewriting both
  // "order" and notification_log. An unused member is harmless.
  pgm.sql(`
    ALTER TABLE notification_log DROP COLUMN provider_message_id;
    ALTER TABLE "order" DROP COLUMN contact_consent_at;
  `);
};
