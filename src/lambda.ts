import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import serverlessHttp from 'serverless-http';
import { loadSecretsIntoEnv } from './lib/awsSecrets';

// `./app` (and everything it imports, down to db/pool.ts) reads
// process.env.DATABASE_URL at module-load time, so secrets must be in
// process.env *before* that module is ever imported. A dynamic import()
// here (rather than a static top-level one) is what makes that ordering
// possible -- it doesn't run until this line executes, after secrets are
// loaded.
let serverlessHandler: ReturnType<typeof serverlessHttp> | undefined;

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  if (!serverlessHandler) {
    await loadSecretsIntoEnv();
    const { buildApp } = await import('./app');
    serverlessHandler = serverlessHttp(buildApp());
  }
  return serverlessHandler(event, context) as Promise<APIGatewayProxyResultV2>;
}
