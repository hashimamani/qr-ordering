import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { NODEJS_RUNTIME } from './runtime';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface ApiStackProps extends StackProps {
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  dbInstance: rds.DatabaseInstance;
  dbName: string;
  appSecret: secretsmanager.Secret;
  notificationsQueue: sqs.Queue;
  connectionsTable: dynamodb.Table;
  webSocketEndpoint: string;
  publicBaseUrl: string;
  publicOrderingBaseUrl: string;
  corsOrigins: string[];
}

/**
 * One Lambda serving every customer/staff/admin HTTP route via API
 * Gateway's proxy integration, wrapping the same Express app
 * (src/app.ts) that local dev runs -- not one-Lambda-per-route as a
 * literal reading of the spec might suggest. That's the standard,
 * practical pattern for moving an existing Express app onto Lambda
 * (what serverless-http exists for); each router file (customerRoutes,
 * staffRoutes, adminRoutes) is already organized so splitting it into
 * separate Lambdas later, if a route's traffic profile ever demands
 * isolation, is a routing change, not a rewrite.
 */
export class ApiStack extends Stack {
  readonly httpApiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // logGroup, not the deprecated logRetention prop -- logRetention
    // provisions its own CDK-managed custom-resource Lambda to apply the
    // retention policy, and that helper Lambda runs on whatever Node
    // runtime is baked into this CDK version (nodejs20.x) regardless of
    // the `runtime` set below, silently adding another deprecated-runtime
    // function to the account.
    const logGroup = new logs.LogGroup(this, 'ApiFunctionLogGroup', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      entry: path.join(__dirname, '../../src/lambda.ts'),
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
      handler: 'handler',
      runtime: NODEJS_RUNTIME,
      memorySize: 512,
      timeout: Duration.seconds(15),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      logGroup,
      environment: {
        DB_SECRET_ARN: props.dbInstance.secret!.secretArn,
        APP_SECRET_ARN: props.appSecret.secretArn,
        DB_HOST: props.dbInstance.instanceEndpoint.hostname,
        DB_PORT: props.dbInstance.instanceEndpoint.port.toString(),
        DB_NAME: props.dbName,
        SQS_NOTIFICATIONS_QUEUE_URL: props.notificationsQueue.queueUrl,
        WS_CONNECTIONS_TABLE: props.connectionsTable.tableName,
        WEBSOCKET_MANAGEMENT_ENDPOINT: props.webSocketEndpoint,
        PUBLIC_BASE_URL: props.publicBaseUrl,
        PUBLIC_ORDERING_BASE_URL: props.publicOrderingBaseUrl,
        NOTIFICATIONS_DRY_RUN: 'false',
        LOG_LEVEL: 'info',
      },
    });

    props.dbInstance.secret!.grantRead(fn);
    props.appSecret.grantRead(fn);
    props.notificationsQueue.grantSendMessages(fn);
    props.connectionsTable.grantReadWriteData(fn); // reads room-index, prunes stale (410) connections

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        // Unlike the WebSocket Lambda's PostToConnection-only replies,
        // this Lambda also force-closes a room's connections once an
        // order is fully complete (see realtime/dynamoBroadcaster.ts) --
        // DeleteConnection's IAM resource ARN uses the actual "DELETE"
        // verb, not "POST", confirmed live (AccessDeniedException named
        // the DELETE-method ARN when only POST was granted).
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/@connections/*`,
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/DELETE/@connections/*`,
        ],
      }),
    );

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      defaultIntegration: new integrations.HttpLambdaIntegration('ApiIntegration', fn),
      // The frontend (S3/CloudFront, plus localhost during dev) is now a
      // genuinely different origin from the API -- POST/PATCH with JSON
      // bodies and the Authorization header both trigger a CORS
      // preflight, so this isn't optional the way it would be for a
      // same-origin bundled setup.
      corsPreflight: {
        allowOrigins: props.corsOrigins,
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // API Gateway's built-in usage-plan throttling covers /track/{token}
    // abuse protection (declarative, no extra service) -- HttpApi's
    // default stage throttle is the equivalent for the HTTP API type
    // (usage plans are a REST API v1 concept; HTTP APIs throttle per
    // route/stage instead).
    const stage = httpApi.defaultStage!.node.defaultChild as apigatewayv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: 50,
      throttlingBurstLimit: 100,
    };

    this.httpApiUrl = httpApi.apiEndpoint;

    new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
      metric: fn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: 'API Lambda error count > 5 in 5 minutes',
    });

    new CfnOutput(this, 'HttpApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'AppSecretArn', { value: props.appSecret.secretArn });
  }
}
