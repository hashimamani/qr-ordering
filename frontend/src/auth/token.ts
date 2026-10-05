/**
 * Reads the expiry out of a JWT so the app can notice a dead session
 * before it makes a request with it.
 *
 * This is not a security check and must never be treated as one -- the
 * payload is decoded, not verified, and anyone can edit it. The API
 * verifies the signature on every request and is the only thing standing
 * between a forged token and real data. The purpose here is purely to
 * stop showing a signed-in UI to someone whose session has already
 * lapsed, and to send them to the login page instead of letting them
 * walk into a wall of 401 banners.
 */

interface JwtPayload {
  exp?: number;
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * A token with no readable `exp` is treated as expired rather than as
 * valid forever. Every token this app issues carries one (12h), so a
 * missing claim means the value is damaged or not one of ours, and the
 * safe reading of "I cannot tell when this dies" is "now".
 *
 * The skew allowance expires a token a few seconds early on purpose: a
 * token with two seconds left passes this check and then fails
 * server-side mid-request, which is exactly the banner-instead-of-
 * redirect behaviour this exists to remove.
 */
const EXPIRY_SKEW_MS = 5000;

export function isTokenExpired(token: string, now: number = Date.now()): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 - EXPIRY_SKEW_MS <= now;
}
