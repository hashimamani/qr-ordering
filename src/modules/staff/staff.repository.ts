import { query } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';

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

/**
 * Partial update, restaurant-scoped -- an admin editing one of their own
 * staff members. Any field omitted (undefined) is left unchanged; the
 * caller (admin.service.ts) is responsible for hashing a new password
 * before it reaches here and for rejecting an empty update up front.
 */
export async function updateStaffUser(
  restaurantId: string,
  staffId: string,
  updates: { name?: string; role?: StaffUser['role']; phoneOrEmail?: string; passwordHash?: string },
): Promise<Omit<StaffUser, 'password_hash'>> {
  const result = await query<Omit<StaffUser, 'password_hash'>>(
    `UPDATE staff_user SET
       name = COALESCE($3, name),
       role = COALESCE($4, role),
       phone_or_email = COALESCE($5, phone_or_email),
       password_hash = COALESCE($6, password_hash)
     WHERE id = $1 AND restaurant_id = $2
     RETURNING id, restaurant_id, name, role, phone_or_email, created_at`,
    [staffId, restaurantId, updates.name, updates.role, updates.phoneOrEmail, updates.passwordHash],
  );
  const staff = result.rows[0];
  if (!staff) throw new NotFoundError('Staff member not found');
  return staff;
}

export async function deleteStaffUser(restaurantId: string, staffId: string): Promise<void> {
  const result = await query('DELETE FROM staff_user WHERE id = $1 AND restaurant_id = $2', [staffId, restaurantId]);
  if (result.rowCount === 0) throw new NotFoundError('Staff member not found');
}

/**
 * The one cross-tenant staff lookup in the codebase -- not restricted to
 * a restaurant_id, deliberately. Reachable only via
 * requirePlatformAdminAuth (platformAdminRoutes.ts), never staff auth,
 * for the platform-admin password-reset flow: a restaurant admin locked
 * out has no other recovery path, and platform admin is explicitly
 * scoped to resetting the admin role only (see platformAdmin.service.ts).
 */
export async function findStaffUserById(staffId: string): Promise<StaffUser | undefined> {
  const result = await query<StaffUser>(
    `SELECT id, restaurant_id, name, role, phone_or_email, password_hash, created_at
     FROM staff_user WHERE id = $1`,
    [staffId],
  );
  return result.rows[0];
}

export async function setStaffPasswordHash(staffId: string, passwordHash: string): Promise<void> {
  await query('UPDATE staff_user SET password_hash = $1 WHERE id = $2', [passwordHash, staffId]);
}

/**
 * For the platform-admin dashboard -- listing which staff_user rows are
 * this restaurant's admins, so platform admin has something to pick from
 * before resetting a password (see platformAdmin routes/service).
 */
export async function listAdminsForRestaurant(
  restaurantId: string,
): Promise<Pick<StaffUser, 'id' | 'name' | 'phone_or_email'>[]> {
  const result = await query<Pick<StaffUser, 'id' | 'name' | 'phone_or_email'>>(
    `SELECT id, name, phone_or_email FROM staff_user WHERE restaurant_id = $1 AND role = 'admin' ORDER BY created_at`,
    [restaurantId],
  );
  return result.rows;
}

// The zero-waiters edge case in broadcastToTableWaiter's fallback --
// otherwise round robin always resolves a real assignee before this
// would ever be consulted.
export async function listWaiterIdsForRestaurant(restaurantId: string): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT id FROM staff_user WHERE restaurant_id = $1 AND role = 'waiter'`,
    [restaurantId],
  );
  return result.rows.map((r) => r.id);
}
