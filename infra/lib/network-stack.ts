import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

/**
 * One NAT Gateway (~$32-38/month, the one fixed cost in an otherwise
 * pay-per-use architecture) shared by every private-subnet Lambda that
 * needs it: RDS access is free within the VPC either way, but the
 * notification-worker specifically also needs to reach Africa's Talking's
 * public API (no AWS VPC endpoint exists for a third-party SaaS), and any
 * VPC-attached Lambda needs *some* path to CloudWatch Logs/Secrets
 * Manager too. See README for the fuller trade-off writeup (a NAT
 * instance is cheaper but self-managed and a single point of failure;
 * this deployment uses the managed Gateway instead).
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private-with-egress', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Shared by every VPC-attached Lambda (API + notification worker)',
      allowAllOutbound: true,
    });
  }
}
