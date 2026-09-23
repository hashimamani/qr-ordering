import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
}

/**
 * db.t4g.micro on RDS PostgreSQL Free Tier (750 hrs/month free for 12
 * months, 20GB included) -- the spec's planned migration to Aurora
 * Serverless v2 once the free tier expires or a paying restaurant depends
 * on this is a `pg_dump`/restore away, not a redesign, since the app was
 * built against standard Postgres throughout.
 *
 * RemovalPolicy.RETAIN on both the instance and its secret: this becomes
 * real customer order history, never take it with an accidental
 * `cdk destroy` (mirrors the same choice in the sms-notify project's
 * DataStack).
 */
export class DataStack extends Stack {
  readonly instance: rds.DatabaseInstance;
  readonly appSecret: secretsmanager.Secret;
  readonly dbName = 'qr_ordering';

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: props.vpc,
      description: 'Postgres -- inbound only from the shared Lambda security group',
      allowAllOutbound: false,
    });
    dbSecurityGroup.addIngressRule(
      props.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Lambda functions (API + notification worker)',
    );

    this.instance = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromGeneratedSecret('qr_ordering_admin'),
      databaseName: this.dbName,
      allocatedStorage: 20,
      maxAllocatedStorage: 20, // stay inside the free tier -- raise once traffic justifies it
      publiclyAccessible: false,
      multiAz: false, // v1 cost trade-off; revisit once a paying restaurant depends on uptime
      backupRetention: Duration.days(7),
      removalPolicy: RemovalPolicy.RETAIN,
      deleteAutomatedBackups: false,
    });

    // generateSecretString only auto-fills one key (jwtSecret) -- CDK
    // creates the secret, it never invents values for the rest.
    // platformAdminJwtSecret, VAPID (web push), and the Africa's Talking/SES
    // credentials ship as empty placeholders and must be set by hand after
    // deploy (same pattern as the AfricasTalkingSecret/TwilioSecret split
    // in the sms-notify project's DataStack), e.g.:
    //   aws secretsmanager put-secret-value --secret-id <arn> \
    //     --secret-string '{"jwtSecret":"...","platformAdminJwtSecret":"...", ...}'
    // platformAdminJwtSecret is deliberately separate from jwtSecret --
    // it signs the platform_admin (super-admin/onboarding) JWT, a
    // distinct identity from staff JWTs, so a leaked staff secret can
    // never forge a platform-admin token.
    //
    // IMPORTANT: changing this secretStringTemplate on an ALREADY-DEPLOYED
    // secret causes CloudFormation to regenerate the whole secret on the
    // next `cdk deploy` that touches this stack, wiping every manually-set
    // field (including ones not being touched by that particular edit)
    // back to these empty placeholders -- confirmed live the hard way when
    // adding platformAdminJwtSecret silently wiped the Africa's Talking
    // credentials and broke SMS. Any future edit here must be followed
    // immediately by a `put-secret-value` restoring every real field, not
    // just the new one.
    this.appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      description:
        "JWT signing secret (auto-generated) plus the platform-admin JWT secret, VAPID web-push keys, and Africa's Talking/SES credentials (set by hand after deploy)",
      removalPolicy: RemovalPolicy.RETAIN,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          platformAdminJwtSecret: '',
          africastalkingApiKey: '',
          africastalkingUsername: '',
          africastalkingSenderId: '',
          sesFromAddress: '',
          vapidPublicKey: '',
          vapidPrivateKey: '',
          vapidSubject: '',
        }),
        generateStringKey: 'jwtSecret',
        excludePunctuation: true,
        passwordLength: 48,
      },
    });
  }
}
