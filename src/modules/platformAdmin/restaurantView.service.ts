import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { signReadOnlyStaffToken } from '../../lib/jwt';
import { findRestaurantMode } from './restaurantReset.repository';

/**
 * Mints a platform admin a read-only look at one restaurant.
 *
 * The token is an ordinary staff token carrying readOnly, so the whole
 * existing admin UI works unchanged -- there is no second, parallel set
 * of read endpoints to keep in step with the real ones, which is how a
 * "view as" feature usually rots into showing stale or different data.
 * requireStaffAuth refuses every non-GET for such a token.
 *
 * Restricted to test-mode restaurants. A platform operator reading a
 * live tenant's trading data is a different and much bigger decision
 * than inspecting a demo, and nothing here should make that easy by
 * accident.
 *
 * It carries no staff_user id in `sub`: the viewer is not a member of
 * this restaurant's staff and must never be mistaken for one. Nothing
 * writes during a read-only session, so no audit row can be attributed
 * to a staff member who does not exist.
 */

export interface RestaurantViewToken {
  token: string;
  restaurant: { id: string; name: string; slug: string };
  expires_in_minutes: number;
}

const TOKEN_MINUTES = 30;

export async function mintRestaurantViewToken(
  restaurantId: string,
  platformAdminId: string,
): Promise<RestaurantViewToken> {
  const restaurant = await findRestaurantMode(restaurantId);
  if (!restaurant) throw new NotFoundError('Restaurant not found');

  if (restaurant.mode !== 'test') {
    throw new ForbiddenError(
      `"${restaurant.name}" is in live mode. Read-only viewing is only available for test restaurants.`,
    );
  }

  const token = signReadOnlyStaffToken({
    sub: `platform-admin:${platformAdminId}`,
    restaurantId: restaurant.id,
    // 'admin' so the existing role gates let the viewer see everything an
    // owner sees. It grants no write ability: readOnly is checked before
    // any role is, and refuses the request outright.
    role: 'admin',
    readOnly: true,
    viewerPlatformAdminId: platformAdminId,
  });

  // Warn, not info: one operator reading another business's data is worth
  // finding in a log without filtering, even though it changes nothing.
  logger.warn(
    { restaurantId: restaurant.id, slug: restaurant.slug, platformAdminId },
    'platform admin opened a read-only view of a restaurant',
  );

  return {
    token,
    restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug },
    expires_in_minutes: TOKEN_MINUTES,
  };
}
