const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3, no DST -- safe to hardcode

/**
 * The Africa/Nairobi calendar date (YYYY-MM-DD) a UTC instant falls on.
 * Used to precompute report_date once, at fact-write time, so reports
 * never run AT TIME ZONE against the operational timestamp at read time.
 * No timezone library needed -- Nairobi has a fixed UTC+3 offset with no
 * DST, so a plain millisecond shift is correct, not an approximation.
 */
export function toNairobiDateString(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Date(date.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}
