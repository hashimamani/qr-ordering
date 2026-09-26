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
    // Without `binary`, serverless-http@3.2.0's default binary-detection
    // reads an unset BINARY_CONTENT_TYPES env var, which evaluates to a
    // regex matching only an *empty* content-type -- so any response with
    // a real Content-Type (our PDF/XLSX report exports) would ship as
    // UTF-8 text instead of base64, corrupting the binary output. API
    // Gateway HTTP API (v2) honours the Lambda response's isBase64Encoded
    // automatically, so no CDK/`binaryMediaTypes` change is needed --
    // this option is the whole fix. text/csv is left off this list
    // deliberately: it's valid UTF-8 and base64 would only inflate it.
    serverlessHandler = serverlessHttp(buildApp(), {
      binary: ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    });
  }
  return serverlessHandler(event, context) as Promise<APIGatewayProxyResultV2>;
}
