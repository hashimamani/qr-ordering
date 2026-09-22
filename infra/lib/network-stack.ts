import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

/**
 * One managed NAT Gateway (~$32-38/month, the one non-pay-per-use line
 * item in this whole architecture) -- shared by every private-subnet
 * Lambda that needs internet egress: RDS access is free within the VPC
 * either way, but the notification-worker specifically also needs to
 * reach Africa's Talking's public API (no AWS VPC endpoint exists for a
 * third-party SaaS), and any VPC-attached Lambda needs *some* path to
 * CloudWatch Logs/Secrets Manager too.
 *
 * A cheaper t4g.nano NAT instance (~$3-4/month, via
 * ec2.NatProvider.instanceV2) was tried first and deployed live, but its
 * traffic forwarding never worked reliably even after multiple fixes
 * (a broken default iptables-services user-data script on AL2023, then a
 * fragile interface-name parse) -- confirmed via VPC Reachability
 * Analyzer that routing/security groups were fine all the way to the
 * instance, but something at the OS level inside it kept silently
 * black-holing traffic, and it couldn't be reached via SSH/SSM to debug
 * further. Reverted to the managed Gateway to unblock a working
 * deployment; revisiting the NAT instance is a good follow-up with more
 * time (e.g. proper SSM Session Manager access wired up first).
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
