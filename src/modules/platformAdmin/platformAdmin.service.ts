import { hashPassword, verifyPassword } from '../../lib/password';
import { signPlatformAdminToken } from '../../lib/jwt';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../lib/errors';
import { findPlatformAdminByEmail, insertPlatformAdmin } from './platformAdmin.repository';
import { findStaffUserById, setStaffPasswordHash } from '../staff/staff.repository';

export interface PlatformAdminLoginResult {
  token: string;
  name: string;
}

export async function loginPlatformAdmin(email: string, password: string): Promise<PlatformAdminLoginResult> {
  const admin = await findPlatformAdminByEmail(email);
  // Same generic error whether the email or the password is wrong --
  // never reveal which one failed, same convention as loginStaff.
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    throw new UnauthorizedError('Invalid credentials');
  }
  const token = signPlatformAdminToken({ sub: admin.id, type: 'platform_admin' });
  return { token, name: admin.name };
}

/**
 * Deliberately scoped to the admin role only -- a restaurant admin
 * locked out of their own account has no other recovery path (they're
 * the one who'd normally reset everyone else's password), so platform
 * admin is the escape hatch for that one case. Not a general "platform
 * admin can touch any staff account" capability: waiter/kitchen/bar
 * accounts stay entirely under their own restaurant admin's control.
 */
export async function resetRestaurantAdminPassword(staffId: string, newPassword: string): Promise<void> {
  const staff = await findStaffUserById(staffId);
  if (!staff || staff.role !== 'admin') {
    throw new ForbiddenError('Platform admin can only reset a restaurant admin\'s password');
  }
  const passwordHash = await hashPassword(newPassword);
  await setStaffPasswordHash(staffId, passwordHash);
}

export async function createPlatformAdmin(
  name: string,
  email: string,
  password: string,
): Promise<{ id: string; name: string; email: string }> {
  const passwordHash = await hashPassword(password);
  try {
    return await insertPlatformAdmin({ name, email, passwordHash });
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
      throw new ConflictError('A platform admin with that email already exists');
    }
    throw err;
  }
}
