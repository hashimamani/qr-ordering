import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

/**
 * A single t4g.nano NAT instance (~$3-4/month) instead of a managed NAT
 * Gateway (~$32-38/month) -- shared by every private-subnet Lambda that
 * needs internet egress: RDS access is free within the VPC either way,
 * but the notification-worker specifically also needs to reach Africa's
 * Talking's public API (no AWS VPC endpoint exists for a third-party
 * SaaS), and any VPC-attached Lambda needs *some* path to CloudWatch
 * Logs/Secrets Manager too.
 *
 * Deliberate trade-off, chosen over the managed Gateway after actually
 * standing the Gateway up first and reconsidering the cost: this is a
 * single EC2 instance with no AWS-managed failover -- if it goes down,
 * every VPC-attached Lambda loses internet egress (RDS access is
 * unaffected, it's intra-VPC) until CDK's auto-recovery or a manual
 * reboot brings it back. Revisit if/when a paying restaurant's
 * reliability needs justify the extra ~$30/month for the managed option.
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGatewayProvider: ec2.NatProvider.instanceV2({
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.NANO),
      }),
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
