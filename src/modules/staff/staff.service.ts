import { findRestaurantBySlug } from '../tables/tables.repository';
import { findStaffUserByRestaurantAndContact } from './staff.repository';
import { verifyPassword } from '../../lib/password';
import { signStaffToken } from '../../lib/jwt';
import { UnauthorizedError } from '../../lib/errors';

export interface LoginResult {
  token: string;
  role: 'admin' | 'waiter' | 'kitchen' | 'bar';
  name: string;
  /**
   * Restaurant identity, returned here rather than put in the JWT: the
   * token is signed, so a name or colour baked into it would go stale the
   * moment an admin edited either, and couldn't be refreshed without
   * forcing everyone to log in again.
   */
  restaurant_name: string;
  brand_color: string | null;
}

export async function loginStaff(
  restaurantSlug: string,
  phoneOrEmail: string,
  password: string,
): Promise<LoginResult> {
  // Same "invalid credentials" error whether the restaurant, the staff
  // user, or the password is wrong — never reveal which one failed.
  // `restaurant` is hoisted out of the try only so its name/colour can be
  // returned below; it stays undefined on any failure path, so the
  // single-error guarantee above is unchanged.
  let restaurant;
  let staffUser;
  try {
    restaurant = await findRestaurantBySlug(restaurantSlug);
    staffUser = await findStaffUserByRestaurantAndContact(restaurant.id, phoneOrEmail);
  } catch {
    staffUser = undefined;
  }

  if (!restaurant || !staffUser || !(await verifyPassword(password, staffUser.password_hash))) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const token = signStaffToken({
    sub: staffUser.id,
    restaurantId: staffUser.restaurant_id,
    role: staffUser.role,
  });

  return {
    token,
    role: staffUser.role,
    name: staffUser.name,
    restaurant_name: restaurant.name,
    brand_color: restaurant.brand_color,
  };
}
