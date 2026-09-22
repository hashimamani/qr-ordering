import runMigrations from 'node-pg-migrate';
import path from 'path';
import { loadSecretsIntoEnv } from './lib/awsSecrets';

interface DiagnoseEvent {
  diagnoseNotificationsForToken?: string;
}

/**
 * Invoked manually (`aws lambda invoke`) by the deploy workflow, after
 * `cdk deploy` and before traffic is expected to hit the new code -- RDS
 * is in a private subnet with no bastion host, so this is how CI/CD runs
 * migrations without provisioning a whole tunnel/bastion setup just for
 * that. migrations/ ships alongside this handler as a bundled asset (see
 * infra/lib/migration-stack.ts's afterBundling hook).
 *
 * The same "no bastion host" problem applies to any ad hoc read against
 * RDS, so `{"diagnoseNotificationsForToken": "<public_token>"}` runs a
 * read-only NotificationLog lookup instead of migrations -- the only way
 * to see a real send's actual provider_response without a tunnel.
 */
export async function handler(event: DiagnoseEvent = {}): Promise<{ statusCode: number; body: string }> {
  await loadSecretsIntoEnv();

  if (event.diagnoseNotificationsForToken) {
    const { query } = await import('./db/pool');
    const result = await query(
      `SELECT nl.trigger, nl.channel, nl.status, nl.sent_at, nl.provider_response
       FROM notification_log nl
       JOIN "order" o ON o.id = nl.order_id
       WHERE o.public_token = $1
       ORDER BY nl.sent_at NULLS LAST`,
      [event.diagnoseNotificationsForToken],
    );
    return { statusCode: 200, body: JSON.stringify(result.rows, null, 2) };
  }

  await runMigrations({
    databaseUrl: process.env.DATABASE_URL!,
    dir: path.join(__dirname, 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => console.log(msg),
  });

  return { statusCode: 200, body: 'migrations applied' };
}
