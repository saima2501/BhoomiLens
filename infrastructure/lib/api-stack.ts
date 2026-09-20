import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ApiStackProps extends StackProps {
  documentsBucket: s3.IBucket;
  recordsTable: dynamodb.ITable;
  referenceTable: dynamodb.ITable;
  auditTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  bedrockPrimaryModelId: string;
  bedrockFallbackModelId: string;
  bedrockRegion: string;
}

export class ApiStack extends Stack {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const backendCodeAsset = lambda.Code.fromAsset(
      path.join(__dirname, '..', '..'),
      {
        exclude: ['**/__pycache__/**', '**/*.pyc', 'tests/**', '.venv/**', 'frontend/node_modules/**', 'infrastructure/node_modules/**', 'infrastructure/cdk.out/**', '.git/**', 'frontend/.next/**'],
      },
    );

    const commonEnv = {
      RECORDS_TABLE: props.recordsTable.tableName,
      REFERENCE_TABLE: props.referenceTable.tableName,
      AUDIT_TABLE: props.auditTable.tableName,
      DOCUMENTS_BUCKET: props.documentsBucket.bucketName,
      BEDROCK_MODEL_ID_PRIMARY: props.bedrockPrimaryModelId,
      BEDROCK_MODEL_ID_FALLBACK: props.bedrockFallbackModelId,
      BEDROCK_REGION: props.bedrockRegion,
      POWERTOOLS_SERVICE_NAME: 'bhoomilens',
    };

    // -----------------------------------------------------------------
    // Lambdas
    // -----------------------------------------------------------------
    const uploadFn = new lambda.Function(this, 'UploadFn', {
      functionName: 'bhoomilens-upload',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.upload.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.recordsTable.grantWriteData(uploadFn);
    uploadFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [`${props.documentsBucket.bucketArn}/raw/*`],
      }),
    );

    const recordsFn = new lambda.Function(this, 'RecordsFn', {
      functionName: 'bhoomilens-records',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.records.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.recordsTable.grantReadWriteData(recordsFn);
    props.referenceTable.grantReadData(recordsFn);
    props.auditTable.grantWriteData(recordsFn);
    recordsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`${props.documentsBucket.bucketArn}/raw/*`],
      }),
    );

    const reviewQueueFn = new lambda.Function(this, 'ReviewQueueFn', {
      functionName: 'bhoomilens-review-queue',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.review_queue.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.recordsTable.grantReadData(reviewQueueFn);

    const dashboardFn = new lambda.Function(this, 'DashboardFn', {
      functionName: 'bhoomilens-dashboard',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.dashboard.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.recordsTable.grantReadData(dashboardFn);

    const auditFn = new lambda.Function(this, 'AuditFn', {
      functionName: 'bhoomilens-audit',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.audit.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.auditTable.grantReadData(auditFn);

    // -----------------------------------------------------------------
    // API Gateway REST API with Cognito authorizer
    // -----------------------------------------------------------------
    this.api = new apigw.RestApi(this, 'BhoomiLensApi', {
      restApiName: 'BhoomiLens API',
      description: 'BhoomiLens REST API — authenticated via Cognito.',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS, // tighten after Amplify domain known
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Amz-Security-Token', 'X-Api-Key'],
        maxAge: Duration.hours(1),
      },
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'BhoomiLensAuthorizer',
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: Duration.minutes(5),
    });

    const authOpts: apigw.MethodOptions = {
      authorizer,
      authorizationType: apigw.AuthorizationType.COGNITO,
    };

    // Routes -----------------------------------------------------------
    const documents = this.api.root.addResource('documents');
    documents.addResource('upload').addMethod(
      'POST',
      new apigw.LambdaIntegration(uploadFn),
      authOpts,
    );

    const records = this.api.root.addResource('records');
    records.addMethod('GET', new apigw.LambdaIntegration(recordsFn), authOpts);

    const record = records.addResource('{id}');
    record.addMethod('GET', new apigw.LambdaIntegration(recordsFn), authOpts);
    record.addMethod('PUT', new apigw.LambdaIntegration(recordsFn), authOpts);

    record.addResource('approve').addMethod(
      'POST',
      new apigw.LambdaIntegration(recordsFn),
      authOpts,
    );
    record.addResource('reject').addMethod(
      'POST',
      new apigw.LambdaIntegration(recordsFn),
      authOpts,
    );
    record.addResource('revalidate').addMethod(
      'POST',
      new apigw.LambdaIntegration(recordsFn),
      authOpts,
    );
    record.addResource('audit').addMethod(
      'GET',
      new apigw.LambdaIntegration(auditFn),
      authOpts,
    );

    this.api.root.addResource('review-queue').addMethod(
      'GET',
      new apigw.LambdaIntegration(reviewQueueFn),
      authOpts,
    );

    const dashboard = this.api.root.addResource('dashboard');
    dashboard.addResource('metrics').addMethod(
      'GET',
      new apigw.LambdaIntegration(dashboardFn),
      authOpts,
    );

    new CfnOutput(this, 'ApiEndpoint', { value: this.api.url });
  }
}
