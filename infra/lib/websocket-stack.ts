import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import * as path from 'path';
import { NODEJS_RUNTIME } from './runtime';

export interface WebSocketStackProps extends StackProps {
  connectionsTable: dynamodb.Table;
  appSecret: secretsmanager.Secret;
}

/**
 * $connect/$disconnect/$default handlers for the API Gateway WebSocket
 * API. None of these touch Postgres (only the connections table and, for
 * $default, JWT verification against appSecret's jwtSecret) so they stay
 * outside the VPC entirely -- no NAT dependency, fast cold starts, and one
 * less thing riding on the network path that costs money either way.
 */
export class WebSocketStack extends Stack {
  readonly webSocketEndpoint: string;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    const commonProps = {
      runtime: NODEJS_RUNTIME,
      memorySize: 256,
      timeout: Duration.seconds(10),
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
    };
    const logGroupProps = { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY };

    const connectFn = new nodejs.NodejsFunction(this, 'ConnectFunction', {
      ...commonProps,
      entry: path.join(__dirname, '../../src/lambda-websocket.ts'),
      handler: 'connectHandler',
      logGroup: new logs.LogGroup(this, 'ConnectFunctionLogGroup', logGroupProps),
    });

    const disconnectFn = new nodejs.NodejsFunction(this, 'DisconnectFunction', {
      ...commonProps,
      entry: path.join(__dirname, '../../src/lambda-websocket.ts'),
      handler: 'disconnectHandler',
      environment: { WS_CONNECTIONS_TABLE: props.connectionsTable.tableName },
      logGroup: new logs.LogGroup(this, 'DisconnectFunctionLogGroup', logGroupProps),
    });

    const defaultFn = new nodejs.NodejsFunction(this, 'DefaultFunction', {
      ...commonProps,
      entry: path.join(__dirname, '../../src/lambda-websocket.ts'),
      handler: 'defaultHandler',
      environment: {
        WS_CONNECTIONS_TABLE: props.connectionsTable.tableName,
        APP_SECRET_ARN: props.appSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'DefaultFunctionLogGroup', logGroupProps),
    });

    props.connectionsTable.grantWriteData(disconnectFn);
    props.connectionsTable.grantWriteData(defaultFn);
    props.appSecret.grantRead(defaultFn);

    // Routes are constructed directly (WebSocketRoute) with explicit
    // construct ids rather than via addRoute()/defaultRouteOptions --
    // addRoute('$default', ...) collides with a same-named resource this
    // CDK version (2.270.0) synthesizes internally for the $default route
    // key ("already contains 'WebSocketApidefaultRoute...'"), a bug in
    // this version rather than anything specific to this app.
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi');
    new apigatewayv2.WebSocketRoute(this, 'WsConnectRoute', {
      webSocketApi,
      routeKey: '$connect',
      integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectFn),
    });
    new apigatewayv2.WebSocketRoute(this, 'WsDisconnectRoute', {
      webSocketApi,
      routeKey: '$disconnect',
      integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectFn),
    });
    new apigatewayv2.WebSocketRoute(this, 'WsDefaultRoute', {
      webSocketApi,
      routeKey: '$default',
      integration: new integrations.WebSocketLambdaIntegration('DefaultIntegration', defaultFn),
    });

    const stage = new apigatewayv2.WebSocketStage(this, 'ProdStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // defaultFn posts replies back to the connection that sent the join
    // message; ApiStack's Lambda posts broadcasts to *other* connections
    // when an order/status changes -- both need this grant.
    webSocketApi.grantManageConnections(defaultFn);

    this.webSocketEndpoint = stage.callbackUrl;

    new CfnOutput(this, 'WebSocketEndpoint', { value: stage.callbackUrl });
  }
}
