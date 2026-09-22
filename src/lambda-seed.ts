import { loadSecretsIntoEnv } from './lib/awsSecrets';
import type { SeedResult } from './db/seed';

/**
 * Invoked by hand (`aws lambda invoke`), same reasoning as
 * lambda-migrate.ts -- RDS has no bastion host, so this is how demo data
 * gets into the deployed database at all.
 */
export async function handler(): Promise<{ statusCode: number; body: string }> {
  await loadSecretsIntoEnv();
  const { seedDatabase } = (await import('./db/seed')) as { seedDatabase: () => Promise<SeedResult> };
  const result = await seedDatabase();
  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
}
