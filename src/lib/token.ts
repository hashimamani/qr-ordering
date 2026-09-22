import { randomUUID } from 'crypto';

/**
 * Cryptographically random, unguessable token (UUIDv4, 122 bits of entropy).
 * Used anywhere a bearer-style identifier is exposed externally
 * (Order.public_token, Table.qr_token) — never a sequential DB id.
 */
export function generateToken(): string {
  return randomUUID();
}
