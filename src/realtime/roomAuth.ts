import { verifyStaffToken } from '../lib/jwt';

export type Destination = 'kitchen' | 'bar' | 'waiter';

export const ORDER_ROOM = /^order:[A-Za-z0-9-]+$/;
export const RESTAURANT_ROOM = /^restaurant:([0-9a-fA-F-]{36}):(kitchen|bar|waiter)$/;

/**
 * Shared by both the local dev `ws` server and the Lambda WebSocket
 * handlers so the two environments enforce identical join rules.
 */
export function isAuthorizedForRestaurantRoom(
  token: string | undefined,
  restaurantId: string,
  destination: Destination,
): boolean {
  if (!token) return false;
  try {
    const payload = verifyStaffToken(token);
    if (payload.restaurantId !== restaurantId) return false;
    if (payload.role === 'admin') return true;
    return payload.role === destination;
  } catch {
    return false;
  }
}
