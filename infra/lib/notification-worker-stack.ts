import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import * as path from 'path';
import { NODEJS_RUNTIME } from './runtime';

export interface NotificationWorkerStackProps extends StackProps {
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  dbInstance: rds.DatabaseInstance;
  dbName: string;
  appSecret: secretsmanager.Secret;
  notificationsQueue: sqs.Queue;
  deadLetterQueue: sqs.Queue;
}

/**
 * The one Lambda in this whole app that genuinely needs internet egress
 * (Africa's Talking has no AWS VPC endpoint), which is why it -- not the
 * API Lambda -- is the reason NetworkStack provisions a NAT Gateway at
 * all. Every send attempt, success or failure, writes its own
 * NotificationLog row (see notifications.service.ts); SQS's own redrive
 * policy (configured on QueueStack's queue) handles retry, so this
 * handler just needs to report which messages in the batch failed.
 */
export class NotificationWorkerStack extends Stack {
  constructor(scope: Construct, id: string, props: NotificationWorkerStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'NotificationWorkerFunctionLogGroup', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new nodejs.NodejsFunction(this, 'NotificationWorkerFunction', {
      entry: path.join(__dirname, '../../src/lambda-notification-worker.ts'),
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
        NOTIFICATIONS_DRY_RUN: 'false',
        LOG_LEVEL: 'info',
      },
    });

    props.dbInstance.secret!.grantRead(fn);
    props.appSecret.grantRead(fn);

    fn.addEventSource(
      new eventsources.SqsEventSource(props.notificationsQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'], // SES doesn't support resource-level identity ARNs for SendEmail
      }),
    );

    new cloudwatch.Alarm(this, 'DlqDepthAlarm', {
      metric: props.deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Messages sitting in the notifications dead-letter queue -- a provider is failing repeatedly',
    });

    new CfnOutput(this, 'NotificationWorkerFunctionName', { value: fn.functionName });
  }
}
