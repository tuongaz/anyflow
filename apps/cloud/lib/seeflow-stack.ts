import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export class SeeflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const diagramsBucket = new s3.Bucket(this, 'DiagramsBucket', {
      bucketName: 'seeflow-diagrams',
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const viewerBucket = new s3.Bucket(this, 'ViewerBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cdk.CfnOutput(this, 'DiagramsBucketName', {
      value: diagramsBucket.bucketName,
      exportName: 'SeeflowDiagramsBucketName',
    });

    new cdk.CfnOutput(this, 'ViewerBucketName', {
      value: viewerBucket.bucketName,
      exportName: 'SeeflowViewerBucketName',
    });
  }
}
