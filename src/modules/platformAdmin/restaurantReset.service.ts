import { NotFoundError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  findRestaurantMode,
  setRestaurantMode,
  resetRestaurantTransactionalData,
  countRestaurantTransactionalData,
  type RestaurantMode,
  type ResetCounts,
} from './restaurantReset.repository';

/**
 * Resetting a restaurant is the most destructive thing this system can
 * do -- it erases trading history that no backup in the app can restore.
 * Three independent things must hold before it proceeds, so that no
 * single slip is enough:
 *
 *   1. the caller is a platform admin (enforced by the route's auth)
 *   2. the restaurant has been deliberately marked 'test'
 *   3. the caller typed that restaurant's exact slug
 *
 * (2) and (3) fail in different ways: the mode catches "right command,
 * wrong tenant", and the typed slug catches "right tenant selected in
 * the UI, wrong one intended". A confirm dialog alone catches neither,
 * which is why there isn't one here.
 */

export async function changeRestaurantMode(
  restaurantId: string,
  mode: RestaurantMode,
  actor: { id: string; email?: string },
): Promise<{ id: string; name: string; slug: string; mode: RestaurantMode }> {
  const restaurant = await findRestaurantMode(restaurantId);
  if (!restaurant) throw new NotFoundError('Restaurant not found');

  if (restaurant.mode !== mode) {
    await setRestaurantMode(restaurantId, mode);
    // Logged at warn deliberately: marking a live restaurant as test is
    // what makes it destroyable, so it deserves to be findable later
    // even though it destroys nothing itself.
    logger.warn(
      { restaurantId, slug: restaurant.slug, from: restaurant.mode, to: mode, actorId: actor.id },
      'restaurant mode changed',
    );
  }

  return { ...restaurant, mode };
}

export async function previewRestaurantReset(restaurantId: string): Promise<{
  restaurant: { id: string; name: string; slug: string; mode: RestaurantMode };
  counts: ResetCounts;
}> {
  const restaurant = await findRestaurantMode(restaurantId);
  if (!restaurant) throw new NotFoundError('Restaurant not found');
  return { restaurant, counts: await countRestaurantTransactionalData(restaurantId) };
}

export async function resetRestaurant(
  restaurantId: string,
  confirmSlug: string,
  actor: { id: string; email?: string },
): Promise<ResetCounts> {
  const restaurant = await findRestaurantMode(restaurantId);
  if (!restaurant) throw new NotFoundError('Restaurant not found');

  if (restaurant.mode !== 'test') {
    throw new ValidationError(
      `"${restaurant.name}" is in live mode. Switch it to test mode before resetting it.`,
    );
  }

  // Compared exactly, not case-folded or trimmed into agreement: the
  // point is to prove the caller knows which restaurant this is, and a
  // lenient match weakens that for no real gain -- slugs are already
  // lowercase and hyphenated, so there is nothing legitimate to forgive.
  if (confirmSlug !== restaurant.slug) {
    throw new ValidationError(
      `Confirmation did not match. Type "${restaurant.slug}" exactly to reset this restaurant.`,
    );
  }

  const counts = await resetRestaurantTransactionalData(restaurantId);

  // There is no audit table for platform-admin actions yet, so this log
  // line is the only record that it happened. Worth promoting to a real
  // table if resets ever become routine.
  logger.warn(
    { restaurantId, slug: restaurant.slug, actorId: actor.id, ...counts },
    'restaurant transactional data reset',
  );

  return counts;
}
