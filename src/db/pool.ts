import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

// RDS's default parameter group rejects unencrypted connections
// ("no pg_hba.conf entry ... no encryption"); local Docker Postgres has
// no SSL configured at all, so this only turns on in Lambda.
// rejectUnauthorized: false trusts the connection is encrypted without
// verifying RDS's certificate chain -- acceptable here since this only
// ever runs inside the private VPC RDS itself lives in, never over the
// public internet; verifying against RDS's CA bundle would be worth
// doing properly before this handles real payment-adjacent traffic.
export const pool = new Pool({
  connectionString,
  ssl: process.env.AWS_LAMBDA_FUNCTION_NAME ? { rejectUnauthorized: false } : undefined,
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
