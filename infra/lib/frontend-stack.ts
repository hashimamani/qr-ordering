import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type { Construct } from 'constructs';

/**
 * The customer/staff frontend, genuinely separate from the API now: a
 * private S3 bucket (no public access, no website hosting mode) behind
 * CloudFront via Origin Access Identity (this CDK version, 2.155.0,
 * predates the newer Origin Access Control API), matching the spec's
 * original "S3 + CloudFront for the customer PWA" design instead of the
 * bundled Lambda shortcut the first pass used to get something demoable
 * quickly.
 *
 * errorResponses redirects 403/404 back to index.html with a 200 --
 * this is a client-side-routed SPA (react-router), so a hard refresh on
 * e.g. /staff/kitchen has no matching S3 object and must fall through to
 * the app shell, which then resolves the route itself.
 *
 * Deliberately does NOT use aws-s3-deployment's BucketDeployment to
 * upload frontend/dist -- that construct's custom resource Lambda in
 * this CDK version bundles a newer awscli/urllib3 that uses `bytes | str`
 * union syntax (Python 3.10+) but runs on a Python 3.9 runtime, so it
 * fails immediately with `TypeError: unsupported operand type(s) for
 * |: 'type' and 'type'` -- confirmed live via CloudWatch Logs on a first
 * deploy attempt. Same category of problem as the NAT instance and
 * WebSocket route bugs elsewhere in this CDK version: upload the built
 * assets and invalidate the cache by hand after `cdk deploy`
 * (`aws s3 sync frontend/dist s3://<bucket> --delete` +
 * `aws cloudfront create-invalidation`), the same "CDK provisions
 * infrastructure, a scripted AWS CLI step handles content" pattern
 * already used for migrations and seeding.
 */
export class FrontendStack extends Stack {
  readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3Origin(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    new CfnOutput(this, 'FrontendUrl', { value: this.distributionUrl });
    new CfnOutput(this, 'FrontendBucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'FrontendDistributionId', { value: distribution.distributionId });
  }
}
