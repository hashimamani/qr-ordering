/* eslint-disable camelcase */

exports.shorthands = undefined;

/**
 * Marks a restaurant as a test tenant or a real one.
 *
 * Its only job is to gate the reset endpoint: wiping a restaurant's
 * trading history is irreversible, and "are you sure?" is not a control
 * -- a mistyped id on a live restaurant destroys real sales records with
 * no way back. Requiring the tenant to have been deliberately marked
 * 'test' first means the destructive call simply refuses on anything
 * else, and marking a live restaurant as test is itself a visible,
 * separate act.
 *
 * Default is 'live', not 'test'. A newly onboarded restaurant that
 * nobody has classified yet must be the protected kind -- the failure
 * mode of the safe default is an extra click before testing, and the
 * failure mode of the unsafe default is a real restaurant losing its
 * history because someone forgot a step.
 *
 * Deliberately NOT tied to notification sending: test restaurants still
 * send real WhatsApp and SMS, so what you see while testing is exactly
 * what a customer sees.
 */
exports.up = (pgm) => {
  pgm.sql(`CREATE TYPE restaurant_mode AS ENUM ('test', 'live');`);
  pgm.sql(`
    ALTER TABLE restaurant
      ADD COLUMN mode restaurant_mode NOT NULL DEFAULT 'live';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE restaurant DROP COLUMN mode;
    DROP TYPE restaurant_mode;
  `);
};
