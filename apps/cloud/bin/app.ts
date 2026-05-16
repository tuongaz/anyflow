#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SeeflowCertStack } from '../lib/seeflow-cert-stack';
import { SeeflowStack } from '../lib/seeflow-stack';

const app = new cdk.App();

const certStack = new SeeflowCertStack(app, 'SeeflowCertStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
});

new SeeflowStack(app, 'SeeflowStack', {
  certificate: certStack.certificate,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  crossRegionReferences: true,
});
