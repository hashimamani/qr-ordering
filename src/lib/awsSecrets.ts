import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

let loaded = false;

// Matches the shape rds.Credentials.fromGeneratedSecret() puts in Secrets
// Manager by default -- just username/password. Host/port/dbname aren't
// secret, so infra/ passes those as plain Lambda environment variables
// (DB_HOST/DB_PORT/DB_NAME) instead of round-tripping them through here.
interface DbSecret {
  username: string;
  password: string;
}

interface AppSecret {
  jwtSecret: string;
  platformAdminKey: string;
  africastalkingApiKey?: string;
  africastalkingUsername?: string;
  africastalkingSenderId?: string;
  sesFromAddress?: string;
}

/**
 * Populates process.env from Secrets Manager on Lambda cold start, once
 * per container. Local dev never calls this -- .env (loaded by dotenv) is
 * already in process.env by the time anything reads it. Real credentials
 * are never checked into config files, per the build spec.
 *
 * Each Lambda is only granted the ARNs it actually needs (see infra/) --
 * the WebSocket handlers, for instance, need JWT_SECRET to verify room
 * auth but never touch Postgres, so DB_SECRET_ARN is simply absent for
 * them and that fetch is skipped entirely.
 */
export async function loadSecretsIntoEnv(): Promise<void> {
  if (loaded) return;
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    loaded = true;
    return;
  }

  const client = new SecretsManagerClient({});
  const fetches: Promise<void>[] = [];

  if (process.env.DB_SECRET_ARN) {
    fetches.push(
      client.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN })).then((result) => {
        const db = JSON.parse(result.SecretString!) as DbSecret;
        const host = process.env.DB_HOST;
        const port = process.env.DB_PORT;
        const dbName = process.env.DB_NAME;
        // sslmode=no-verify: RDS's default parameter group rejects
        // unencrypted connections outright ("no pg_hba.conf entry ...
        // no encryption"), and node-pg-migrate builds its own pg Client
        // straight from this URL (bypassing db/pool.ts's ssl option
        // entirely), so SSL has to be encoded in the URL itself to cover
        // both paths. no-verify (not just require) skips CA chain
        // verification -- same trust tradeoff as pool.ts's
        // rejectUnauthorized: false, for the same reason (private VPC
        // only, never the public internet).
        process.env.DATABASE_URL = `postgres://${encodeURIComponent(db.username)}:${encodeURIComponent(db.password)}@${host}:${port}/${dbName}?sslmode=no-verify`;
      }),
    );
  }

  if (process.env.APP_SECRET_ARN) {
    fetches.push(
      client.send(new GetSecretValueCommand({ SecretId: process.env.APP_SECRET_ARN })).then((result) => {
        const appSecret = JSON.parse(result.SecretString!) as AppSecret;
        process.env.JWT_SECRET = appSecret.jwtSecret;
        process.env.PLATFORM_ADMIN_KEY = appSecret.platformAdminKey;
        process.env.AFRICASTALKING_API_KEY = appSecret.africastalkingApiKey ?? '';
        process.env.AFRICASTALKING_USERNAME = appSecret.africastalkingUsername ?? '';
        process.env.AFRICASTALKING_SENDER_ID = appSecret.africastalkingSenderId ?? '';
        process.env.SES_FROM_ADDRESS = appSecret.sesFromAddress ?? '';
      }),
    );
  }

  await Promise.all(fetches);
  loaded = true;
}
