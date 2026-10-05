import { describe, it, expect } from 'vitest';
import { isTokenExpired, decodeJwtPayload } from './token';

/**
 * The expiry read is what decides between "send them to login" and "show
 * them a signed-in page that 401s on every request", so the edges matter
 * more than the happy path -- particularly the malformed cases, which
 * must fail closed.
 */
function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const NOW = 1_700_000_000_000;
const inSeconds = (ms: number) => Math.floor((NOW + ms) / 1000);

describe('token expiry', () => {
  it('accepts a token with time left on it', () => {
    expect(isTokenExpired(makeToken({ exp: inSeconds(60 * 60 * 1000) }), NOW)).toBe(false);
  });

  it('rejects a token whose expiry has passed', () => {
    expect(isTokenExpired(makeToken({ exp: inSeconds(-60 * 1000) }), NOW)).toBe(true);
  });

  // A token with a couple of seconds left passes a naive check and then
  // fails server-side mid-request -- the banner this whole change exists
  // to remove. The skew expires it slightly early instead.
  it('rejects a token that is about to expire within the skew window', () => {
    expect(isTokenExpired(makeToken({ exp: inSeconds(2000) }), NOW)).toBe(true);
  });

  it('accepts one just outside the skew window', () => {
    expect(isTokenExpired(makeToken({ exp: inSeconds(10_000) }), NOW)).toBe(false);
  });

  // Failing closed: "I cannot tell when this dies" must mean "now", not
  // "never".
  it('treats a token with no exp claim as expired', () => {
    expect(isTokenExpired(makeToken({ sub: 'abc' }), NOW)).toBe(true);
  });

  it('treats a non-numeric exp as expired', () => {
    expect(isTokenExpired(makeToken({ exp: 'soon' }), NOW)).toBe(true);
  });

  it('treats garbage as expired rather than throwing', () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a..c', 'a.!!!not-base64!!!.c']) {
      expect(() => isTokenExpired(bad, NOW)).not.toThrow();
      expect(isTokenExpired(bad, NOW)).toBe(true);
    }
  });
});

describe('payload decoding', () => {
  it('reads a base64url payload containing - and _', () => {
    const payload = { sub: 'a-b_c', exp: 123 };
    expect(decodeJwtPayload(makeToken(payload))).toEqual(payload);
  });

  it('returns null for a malformed token instead of throwing', () => {
    expect(decodeJwtPayload('nonsense')).toBeNull();
  });
});
