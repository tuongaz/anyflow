import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

export class SeeflowCertStack extends cdk.Stack {
  readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'seeflow.dev',
    });

    this.certificate = new acm.Certificate(this, 'SeeflowCertificate', {
      domainName: 'seeflow.dev',
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
  }
}
