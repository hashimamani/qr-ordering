#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { RealtimeDataStack } from '../lib/realtime-data-stack';
import { QueueStack } from '../lib/queue-stack';
import { WebSocketStack } from '../lib/websocket-stack';
import { ApiStack } from '../lib/api-stack';
import { NotificationWorkerStack } from '../lib/notification-worker-stack';
import { MigrationStack } from '../lib/migration-stack';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-1', // Africa's Talking latency: pick the AWS region closest to Kenya you're allowed to deploy in
};

// Every stack that carries a URL an app config needs to know ahead of
// deploy (tracking links, generated QR codes) -- set for real before
// `cdk deploy` once the frontend/PWA has a domain.
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'https://REPLACE_WITH_API_DOMAIN';
const publicOrderingBaseUrl = process.env.PUBLIC_ORDERING_BASE_URL ?? publicBaseUrl;

const network = new NetworkStack(app, 'QrOrderingNetwork', { env });

const data = new DataStack(app, 'QrOrderingData', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
});

const realtimeData = new RealtimeDataStack(app, 'QrOrderingRealtimeData', { env });

const queue = new QueueStack(app, 'QrOrderingQueue', { env });

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
  connectionsTable: realtimeData.connectionsTable,
  webSocketEndpoint: webSocket.webSocketEndpoint,
  publicBaseUrl,
  publicOrderingBaseUrl,
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

new MigrationStack(app, 'QrOrderingMigration', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbInstance: data.instance,
  dbName: data.dbName,
  appSecret: data.appSecret,
});
