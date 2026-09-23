import { query } from '../../db/pool';

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export async function findPlatformAdminByEmail(email: string): Promise<PlatformAdmin | undefined> {
  const result = await query<PlatformAdmin>(
    'SELECT id, name, email, password_hash, created_at FROM platform_admin WHERE email = $1',
    [email],
  );
  return result.rows[0];
}

export async function insertPlatformAdmin(input: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<Omit<PlatformAdmin, 'password_hash'>> {
  const result = await query<Omit<PlatformAdmin, 'password_hash'>>(
    `INSERT INTO platform_admin (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, created_at`,
    [input.name, input.email, input.passwordHash],
  );
  return result.rows[0];
}
