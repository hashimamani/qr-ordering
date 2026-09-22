import { findRestaurantBySlug } from '../tables/tables.repository';
import { findStaffUserByRestaurantAndContact } from './staff.repository';
import { verifyPassword } from '../../lib/password';
import { signStaffToken } from '../../lib/jwt';
import { UnauthorizedError } from '../../lib/errors';

export interface LoginResult {
  token: string;
  role: 'admin' | 'waiter' | 'kitchen' | 'bar';
  name: string;
}

export async function loginStaff(
  restaurantSlug: string,
  phoneOrEmail: string,
  password: string,
): Promise<LoginResult> {
  // Same "invalid credentials" error whether the restaurant, the staff
  // user, or the password is wrong — never reveal which one failed.
  let staffUser;
  try {
    const restaurant = await findRestaurantBySlug(restaurantSlug);
    staffUser = await findStaffUserByRestaurantAndContact(restaurant.id, phoneOrEmail);
  } catch {
    staffUser = undefined;
  }

  if (!staffUser || !(await verifyPassword(password, staffUser.password_hash))) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const token = signStaffToken({
    sub: staffUser.id,
    restaurantId: staffUser.restaurant_id,
    role: staffUser.role,
  });

  return { token, role: staffUser.role, name: staffUser.name };
}
