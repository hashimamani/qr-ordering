import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import * as path from 'path';
import { NODEJS_RUNTIME } from './runtime';

export interface ReportingWorkerStackProps extends StackProps {
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  dbInstance: rds.DatabaseInstance;
  dbName: string;
  appSecret: secretsmanager.Secret;
  reportingQueue: sqs.Queue;
  deadLetterQueue: sqs.Queue;
  connectionsTable: dynamodb.Table;
  webSocketEndpoint: string;
}

/**
 * Mirrors NotificationWorkerStack's shape exactly (same VPC/subnet, so it
 * inherits the same NAT-provided egress already needed to reach the API
 * Gateway Management API -- no new networking). Differs in what it's
 * granted: this worker never sends SMS/email, but it does broadcast to the
 * admin room after writing a fact row (see reportingEvents.worker.ts), so
 * it needs the connections-table + PostToConnection grants api-stack.ts
 * already has for the API Lambda -- just the POST-method ARN, not DELETE,
 * since this worker only ever broadcasts, never force-closes a room.
 */
export class ReportingWorkerStack extends Stack {
  constructor(scope: Construct, id: string, props: ReportingWorkerStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'ReportingWorkerFunctionLogGroup', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new nodejs.NodejsFunction(this, 'ReportingWorkerFunction', {
      entry: path.join(__dirname, '../../src/lambda-reporting-worker.ts'),
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
      handler: 'handler',
      runtime: NODEJS_RUNTIME,
      memorySize: 256,
      timeout: Duration.seconds(20),
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
        WS_CONNECTIONS_TABLE: props.connectionsTable.tableName,
        WEBSOCKET_MANAGEMENT_ENDPOINT: props.webSocketEndpoint,
        NOTIFICATIONS_DRY_RUN: 'false',
        LOG_LEVEL: 'info',
      },
    });

    props.dbInstance.secret!.grantRead(fn);
    props.appSecret.grantRead(fn);
    props.connectionsTable.grantReadWriteData(fn); // reads room-index; prunes stale (410) connections

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [`arn:aws:execute-api:${this.region}:${this.account}:*/*/POST/@connections/*`],
      }),
    );

    fn.addEventSource(
      new eventsources.SqsEventSource(props.reportingQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    new cloudwatch.Alarm(this, 'ReportingDlqDepthAlarm', {
      metric: props.deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Messages sitting in the reporting-events dead-letter queue -- fact tables are falling behind or a write is failing repeatedly',
    });

    new CfnOutput(this, 'ReportingWorkerFunctionName', { value: fn.functionName });
  }
}
