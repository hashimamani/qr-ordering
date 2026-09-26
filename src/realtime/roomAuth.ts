import { verifyStaffToken } from '../lib/jwt';

// 'admin' isn't a real order_item_destination -- it's a room suffix
// reusing this same slot, deliberately, so isAuthorizedForRestaurantRoom's
// existing `payload.role === 'admin' -> true` early return (and its
// `payload.role === destination` fallback correctly rejecting kitchen/bar/
// waiter roles from it) covers this room with zero new authorization logic.
export type Destination = 'kitchen' | 'bar' | 'admin';

export const ORDER_ROOM = /^order:[A-Za-z0-9-]+$/;
export const RESTAURANT_ROOM = /^restaurant:([0-9a-fA-F-]{36}):(kitchen|bar|admin)$/;
// Each waiter joins their own personal room rather than a shared
// restaurant-wide one, since waiters only ever act on tables assigned to
// them -- see admin/tables.repository.ts's assignNextWaiterRoundRobin.
export const WAITER_ROOM = /^restaurant:([0-9a-fA-F-]{36}):waiter:([0-9a-fA-F-]{36})$/;

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

/**
 * A waiter may only join their own personal room (matched by the JWT's
 * own `sub`, not the DB) -- admin can join any waiter's room too, same as
 * every other destination. No DB lookup here: which table is whose is
 * resolved once at broadcast time, not on every join, so this stays as
 * cheap as isAuthorizedForRestaurantRoom.
 */
export function isAuthorizedForWaiterRoom(
  token: string | undefined,
  restaurantId: string,
  staffId: string,
): boolean {
  if (!token) return false;
  try {
    const payload = verifyStaffToken(token);
    if (payload.restaurantId !== restaurantId) return false;
    if (payload.role === 'admin') return true;
    return payload.role === 'waiter' && payload.sub === staffId;
  } catch {
    return false;
  }
}
