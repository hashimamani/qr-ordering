import { hashPassword, verifyPassword } from '../../lib/password';
import { signPlatformAdminToken } from '../../lib/jwt';
import { ConflictError, UnauthorizedError } from '../../lib/errors';
import { findPlatformAdminByEmail, insertPlatformAdmin } from './platformAdmin.repository';

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
