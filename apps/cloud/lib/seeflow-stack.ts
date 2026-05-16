import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'path';
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

    const apiFunction = new lambdaNodejs.NodejsFunction(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/api/index.ts'),
      handler: 'handler',
      environment: {
        DIAGRAMS_BUCKET_NAME: diagramsBucket.bucketName,
      },
    });

    diagramsBucket.grantReadWrite(apiFunction);

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'SeeflowApi',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', apiFunction);

    httpApi.addRoutes({
      path: '/flows',
      methods: [apigwv2.HttpMethod.POST],
      integration,
    });

    httpApi.addRoutes({
      path: '/flows/{uuid}',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    httpApi.addRoutes({
      path: '/flows/{uuid}/files/{proxy+}',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });

    new cdk.CfnOutput(this, 'DiagramsBucketName', {
      value: diagramsBucket.bucketName,
      exportName: 'SeeflowDiagramsBucketName',
    });

    new cdk.CfnOutput(this, 'ViewerBucketName', {
      value: viewerBucket.bucketName,
      exportName: 'SeeflowViewerBucketName',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      exportName: 'SeeflowApiUrl',
    });
  }
}
