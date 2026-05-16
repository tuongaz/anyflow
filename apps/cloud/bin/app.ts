#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SeeflowStack } from '../lib/seeflow-stack';

const app = new cdk.App();
new SeeflowStack(app, 'SeeflowStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
