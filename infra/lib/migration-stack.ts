import { Duration, Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import * as path from 'path';

export interface MigrationStackProps extends StackProps {
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  dbInstance: rds.DatabaseInstance;
  dbName: string;
  appSecret: secretsmanager.Secret;
}

/**
 * Two Lambdas invoked by hand (`aws lambda invoke`), never by any
 * automatic trigger -- RDS sits in a private subnet with no bastion host,
 * so this is the only way to run pending migrations or load demo data
 * into the deployed database at all. The deploy workflow calls the
 * migration one explicitly, after `cdk deploy` and before the new API
 * code is expected to see live traffic; the seed one is a manual,
 * one-off "give me a demo restaurant to test against" call.
 */
export class MigrationStack extends Stack {
  constructor(scope: Construct, id: string, props: MigrationStackProps) {
    super(scope, id, props);

    const commonEnv = {
      DB_SECRET_ARN: props.dbInstance.secret!.secretArn,
      APP_SECRET_ARN: props.appSecret.secretArn,
      DB_HOST: props.dbInstance.instanceEndpoint.hostname,
      DB_PORT: props.dbInstance.instanceEndpoint.port.toString(),
      DB_NAME: props.dbName,
    };
    const commonProps = {
      projectRoot: path.join(__dirname, '../..'),
      depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.minutes(2),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      logRetention: logs.RetentionDays.ONE_MONTH,
    };

    const migrateFn = new nodejs.NodejsFunction(this, 'MigrationFunction', {
      ...commonProps,
      entry: path.join(__dirname, '../../src/lambda-migrate.ts'),
      environment: commonEnv,
      bundling: {
        // node-pg-migrate loads migration files from disk by directory
        // glob at runtime (not a static import esbuild would follow), so
        // the compiled JS migrations have to be copied into the bundle
        // by hand.
        commandHooks: {
          beforeBundling: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `mkdir -p ${outputDir}/migrations`,
            `cp ${inputDir}/migrations/*.js ${outputDir}/migrations/`,
          ],
          beforeInstall: () => [],
        },
      },
    });

    const seedFn = new nodejs.NodejsFunction(this, 'SeedFunction', {
      ...commonProps,
      entry: path.join(__dirname, '../../src/lambda-seed.ts'),
      environment: commonEnv,
    });

    props.dbInstance.secret!.grantRead(migrateFn);
    props.appSecret.grantRead(migrateFn);
    props.dbInstance.secret!.grantRead(seedFn);
    props.appSecret.grantRead(seedFn);

    new CfnOutput(this, 'MigrationFunctionName', { value: migrateFn.functionName });
    new CfnOutput(this, 'SeedFunctionName', { value: seedFn.functionName });
  }
}
