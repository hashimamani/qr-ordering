/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE order_payment_status AS ENUM ('unpaid', 'paid');
    ALTER TABLE "order" ADD COLUMN payment_status order_payment_status NOT NULL DEFAULT 'unpaid';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE "order" DROP COLUMN payment_status;
    DROP TYPE order_payment_status;
  `);
};
