import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * This CDK version (2.155.0, deliberately pinned -- see network-stack.ts's
 * WebSocket construct comment) predates AWS Lambda's Node.js 22 support,
 * so there's no lambda.Runtime.NODEJS_22_X constant to reach for. AWS
 * Lambda the *service* supports nodejs22.x regardless of what this CDK
 * library version knows about -- CloudFormation just passes the runtime
 * string through -- so it's constructed directly, exactly as the
 * Runtime class's own docstring describes for this situation
 * ("can instantiate a Runtime object, e.g: `new Runtime('nodejs99.99')`").
 * Node.js 20 support in Lambda ends April 2026; every function in this
 * app uses this shared constant so there's one place to bump later.
 */
export const NODEJS_RUNTIME = new lambda.Runtime('nodejs22.x', lambda.RuntimeFamily.NODEJS, {
  supportsInlineCode: true,
});
