/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE "table" ADD COLUMN removed_at TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE "table" DROP COLUMN removed_at;
  `);
};
