import { loadSecretsIntoEnv } from './lib/awsSecrets';
import type { SeedResult } from './db/seed';

interface SeedEvent {
  createPlatformAdmin?: { name: string; email: string; password: string };
}

/**
 * Invoked by hand (`aws lambda invoke`), same reasoning as
 * lambda-migrate.ts -- RDS has no bastion host, so this is how demo data
 * gets into the deployed database at all.
 *
 * `{"createPlatformAdmin": {"name": "...", "email": "...", "password": "..."}}`
 * creates a real platform_admin (super-admin) instead of running the demo
 * seed -- deliberately not part of seedDatabase() itself, since that
 * function runs on every plain `{}` invocation and a well-known demo
 * password has no business becoming a real onboarding credential.
 */
export async function handler(event: SeedEvent = {}): Promise<{ statusCode: number; body: string }> {
  await loadSecretsIntoEnv();

  if (event.createPlatformAdmin) {
    const { createPlatformAdmin } = await import('./modules/platformAdmin/platformAdmin.service');
    const { name, email, password } = event.createPlatformAdmin;
    const admin = await createPlatformAdmin(name, email, password);
    return { statusCode: 200, body: JSON.stringify({ created: admin }, null, 2) };
  }

  const { seedDatabase } = (await import('./db/seed')) as { seedDatabase: () => Promise<SeedResult> };
  const result = await seedDatabase();
  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
}
