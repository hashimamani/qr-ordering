#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { RealtimeDataStack } from '../lib/realtime-data-stack';
import { QueueStack } from '../lib/queue-stack';
import { ReportingQueueStack } from '../lib/reporting-queue-stack';
import { WebSocketStack } from '../lib/websocket-stack';
import { ApiStack } from '../lib/api-stack';
import { NotificationWorkerStack } from '../lib/notification-worker-stack';
import { ReportingWorkerStack } from '../lib/reporting-worker-stack';
import { MigrationStack } from '../lib/migration-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  // Fixed, not read from CDK_DEFAULT_REGION -- eu-west-1 was a deliberate
  // choice (latency to Kenya/Africa's Talking) over the account's default
  // profile region (us-east-1, used by other projects on this account),
  // so it shouldn't silently follow whatever profile happens to be active.
  region: 'eu-west-1',
};

// The frontend (S3/CloudFront) is a separate origin from the API now, and
// it's what tracking links and QR codes need to point at -- not the API
// Gateway domain. FRONTEND_URL is unknown on the very first deploy (the
// CloudFront distribution doesn't exist yet), so it falls back to a local
// dev URL; set it for real and redeploy ApiStack + FrontendStack once
// QrOrderingFrontend's CfnOutput is known.
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const corsOrigins = Array.from(new Set([frontendUrl, 'http://localhost:5173']));

const network = new NetworkStack(app, 'QrOrderingNetwork', { env });

const data = new DataStack(app, 'QrOrderingData', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
});

const realtimeData = new RealtimeDataStack(app, 'QrOrderingRealtimeData', { env });

const queue = new QueueStack(app, 'QrOrderingQueue', { env });
const reportingQueue = new ReportingQueueStack(app, 'QrOrderingReportingQueue', { env });

const webSocket = new WebSocketStack(app, 'QrOrderingWebSocket', {
  env,
  connectionsTable: realtimeData.connectionsTable,
  appSecret: data.appSecret,
});

const api = new ApiStack(app, 'QrOrderingApi', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbInstance: data.instance,
  dbName: data.dbName,
  appSecret: data.appSecret,
  notificationsQueue: queue.notificationsQueue,
  reportingQueue: reportingQueue.reportingQueue,
  connectionsTable: realtimeData.connectionsTable,
  webSocketEndpoint: webSocket.webSocketEndpoint,
  publicBaseUrl: frontendUrl,
  publicOrderingBaseUrl: frontendUrl,
  corsOrigins,
});
api.addDependency(webSocket);

new NotificationWorkerStack(app, 'QrOrderingNotificationWorker', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbInstance: data.instance,
  dbName: data.dbName,
  appSecret: data.appSecret,
  notificationsQueue: queue.notificationsQueue,
  deadLetterQueue: queue.deadLetterQueue,
});

new ReportingWorkerStack(app, 'QrOrderingReportingWorker', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbInstance: data.instance,
  dbName: data.dbName,
  appSecret: data.appSecret,
  reportingQueue: reportingQueue.reportingQueue,
  deadLetterQueue: reportingQueue.deadLetterQueue,
  connectionsTable: realtimeData.connectionsTable,
  webSocketEndpoint: webSocket.webSocketEndpoint,
});

new MigrationStack(app, 'QrOrderingMigration', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbInstance: data.instance,
  dbName: data.dbName,
  appSecret: data.appSecret,
});

new FrontendStack(app, 'QrOrderingFrontend', { env });
