import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

/**
 * A t4g.nano NAT instance (~$3-7/month) rather than a managed NAT
 * Gateway (~$36/month including its Elastic IP) -- shared by every
 * private-subnet Lambda needing internet egress. RDS is intra-VPC and
 * unaffected either way; this exists because the notification worker
 * reaches Africa's Talking and Meta, and any VPC-attached Lambda needs
 * some path to CloudWatch Logs and Secrets Manager.
 *
 * IPv6 with a (free) egress-only gateway was investigated as the
 * cheaper option and rejected on evidence: api.africastalking.com
 * publishes no AAAA record at all, and neither does API Gateway's
 * execute-api -- which the API Lambda calls for every websocket
 * broadcast. An IPv6-only egress would have killed realtime.
 *
 * THIS WAS TRIED ONCE BEFORE AND FAILED. The cause was CDK's stock
 * NatInstanceProviderV2 user data, which ends with:
 *
 *   iptables -t nat -A POSTROUTING -o $(route | awk '/^default/{print $NF}') -j MASQUERADE
 *
 * `route` comes from net-tools, which is not installed on Amazon Linux
 * 2023. The subshell yields an empty string, so -o receives no interface
 * and the masquerade rule never applies correctly -- traffic arrives at
 * the instance and is silently dropped, which is exactly what the
 * Reachability Analyzer could not see. The custom user data below uses
 * iproute2 (always present) and fails loudly if it cannot determine the
 * interface, rather than carrying on with an empty one.
 *
 * The instance also gets SSM Session Manager, which the previous attempt
 * lacked -- being unable to get a shell on it was why the failure could
 * not be diagnosed.
 *
 * The trade-off remains deliberate: one instance, no AWS-managed
 * failover. If it dies, VPC Lambdas lose internet egress (RDS keeps
 * working) until it recovers. At ~$30/month saved on a ~$50 bill that is
 * worth it here; revisit when a paying restaurant's uptime is worth more
 * than the saving.
 */

/**
 * Runs once at first boot. The rules are saved to /etc/sysconfig/iptables
 * and the iptables unit enabled, so they are restored on reboot -- rules
 * applied only in memory would vanish the first time the instance
 * restarted, taking every Lambda's internet access with them.
 */
const NAT_SETUP = [
  '#!/bin/bash',
  'set -euxo pipefail',
  '# No exec/tee/logger redirection here: a process-substitution pipe at',
  '# the top of cloud-init user data hangs the script before anything',
  '# runs. cloud-init already captures stdout and stderr to',
  '# /var/log/cloud-init-output.log, which is where to look.',
  '',
  '# iproute2, not net-tools: `route` does not exist on AL2023 and the',
  '# stock CDK script silently produced an empty interface name here.',
  'IFACE="$(ip -o -4 route show to default | awk \'{print $5}\' | head -1)"',
  'if [ -z "$IFACE" ]; then echo "FATAL: no default route interface" >&2; exit 1; fi',
  'echo "NAT egress interface: $IFACE"',
  '',
  'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-nat.conf',
  'sysctl -p /etc/sysctl.d/99-nat.conf',
  '',
  '# iptables-nft provides /usr/sbin/iptables on AL2023; iptables-services',
  '# provides the unit that restores the saved rules at boot. Neither is',
  '# present on the base image.',
  'dnf install -y iptables-nft iptables-services',
  '',
  '# -F first so a re-run cannot stack duplicate MASQUERADE rules.',
  'iptables -t nat -F POSTROUTING',
  'iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE',
  'iptables -P FORWARD ACCEPT',
  'iptables -F FORWARD',
  '',
  '# Persist and restore on boot.',
  'iptables-save > /etc/sysconfig/iptables',
  'systemctl enable iptables',
  'systemctl start iptables',
  '',
  '# A marker the verification step can read over SSM without parsing logs.',
  'iptables -t nat -L POSTROUTING -n -v > /var/log/nat-rules.txt',
  'echo "nat-setup-complete" > /var/log/nat-ready',
];

export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const natUserData = ec2.UserData.forLinux();
    natUserData.addCommands(...NAT_SETUP.slice(1));

    const natProvider = ec2.NatProvider.instanceV2({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.NANO),
      userData: natUserData,
      // The default is INBOUND_AND_OUTBOUND, which opens the NAT instance
      // to the entire internet on every port. It only ever needs to
      // accept traffic from inside this VPC; ingress is added below.
      defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
    });

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGatewayProvider: natProvider,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private-with-egress', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // Forwarded traffic arrives from private-subnet addresses, so the
    // instance has to accept it -- but only from inside the VPC, never
    // from the internet.
    natProvider.securityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
      'Forwarded egress from private subnets',
    );

    // SSM Session Manager. The previous attempt at this failed partly
    // because there was no way to get a shell on the instance and look at
    // what iptables was actually doing.
    for (const instance of natProvider.gatewayInstances) {
      instance.role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      );
    }

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Shared by every VPC-attached Lambda (API + notification worker)',
      allowAllOutbound: true,
    });
  }
}
