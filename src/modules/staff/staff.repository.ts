import { query } from '../../db/pool';

export interface StaffUser {
  id: string;
  restaurant_id: string;
  name: string;
  role: 'admin' | 'waiter' | 'kitchen' | 'bar';
  phone_or_email: string;
  password_hash: string;
  created_at: string;
}

export async function findStaffUserByRestaurantAndContact(
  restaurantId: string,
  phoneOrEmail: string,
): Promise<StaffUser | undefined> {
  const result = await query<StaffUser>(
    `SELECT id, restaurant_id, name, role, phone_or_email, password_hash, created_at
     FROM staff_user
     WHERE restaurant_id = $1 AND phone_or_email = $2`,
    [restaurantId, phoneOrEmail],
  );
  return result.rows[0];
}

export async function insertStaffUser(input: {
  restaurantId: string;
  name: string;
  role: StaffUser['role'];
  phoneOrEmail: string;
  passwordHash: string;
}): Promise<Omit<StaffUser, 'password_hash'>> {
  const result = await query<Omit<StaffUser, 'password_hash'>>(
    `INSERT INTO staff_user (restaurant_id, name, role, phone_or_email, password_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, restaurant_id, name, role, phone_or_email, created_at`,
    [input.restaurantId, input.name, input.role, input.phoneOrEmail, input.passwordHash],
  );
  return result.rows[0];
}

export async function listStaffUsersForRestaurant(
  restaurantId: string,
): Promise<Omit<StaffUser, 'password_hash'>[]> {
  const result = await query<Omit<StaffUser, 'password_hash'>>(
    `SELECT id, restaurant_id, name, role, phone_or_email, created_at
     FROM staff_user
     WHERE restaurant_id = $1
     ORDER BY created_at`,
    [restaurantId],
  );
  return result.rows;
}
