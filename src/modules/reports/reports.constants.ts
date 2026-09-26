export const MAX_RANGE_DAYS = 366;
export const MAX_RAW_ROWS = 25_000;

/**
 * Surfaced both in every export and in the frontend footnote, so the two
 * accepted approximations (and the eventual-consistency lag) are visible
 * to whoever is reading the numbers, not just documented in code.
 */
export const HISTORICAL_ACCURACY_NOTE =
  'Orders placed before reporting was enabled use each menu item’s price and each table’s ' +
  'waiter assignment at the time this feature launched, not necessarily at the time of the order. ' +
  'All orders since then are exact. The dashboard reflects reporting data written by an asynchronous ' +
  'worker a moment after each event -- usually near-instant, but not guaranteed to be instantaneous.';
