import runMigrations from 'node-pg-migrate';
import path from 'path';
import { loadSecretsIntoEnv } from './lib/awsSecrets';

/**
 * Invoked manually (`aws lambda invoke`) by the deploy workflow, after
 * `cdk deploy` and before traffic is expected to hit the new code -- RDS
 * is in a private subnet with no bastion host, so this is how CI/CD runs
 * migrations without provisioning a whole tunnel/bastion setup just for
 * that. migrations/ ships alongside this handler as a bundled asset (see
 * infra/lib/migration-stack.ts's afterBundling hook).
 */
export async function handler(): Promise<{ statusCode: number; body: string }> {
  await loadSecretsIntoEnv();

  await runMigrations({
    databaseUrl: process.env.DATABASE_URL!,
    dir: path.join(__dirname, 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => console.log(msg),
  });

  return { statusCode: 200, body: 'migrations applied' };
}
