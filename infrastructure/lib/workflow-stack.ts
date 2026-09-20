import { Duration, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface WorkflowStackProps extends StackProps {
  documentsBucket: s3.IBucket;
  recordsTable: dynamodb.ITable;
  referenceTable: dynamodb.ITable;
  auditTable: dynamodb.ITable;
  ocrEcrRepo: ecr.IRepository;
  bedrockPrimaryModelId: string;
  bedrockFallbackModelId: string;
  bedrockRegion: string;
}

/**
 * The asynchronous ingestion pipeline.
 *
 *   S3 ObjectCreated → EventBridge → Step Functions (Express)
 *
 * State machine:
 *   GetMetadata → OCR → BedrockExtract → Validate → Persist
 *
 * Per spec Section 4: no waitForTaskToken. Human review lives outside
 * this state machine and is a plain REST + DynamoDB operation.
 */
export class WorkflowStack extends Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
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
    // GetMetadata Lambda
    // -----------------------------------------------------------------
    const getMetadataFn = new lambda.Function(this, 'GetMetadataFn', {
      functionName: 'bhoomilens-get-metadata',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.get_metadata.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.documentsBucket.grantRead(getMetadataFn, 'raw/*');
    props.recordsTable.grantReadData(getMetadataFn);

    // -----------------------------------------------------------------
    // OCR Lambda — container image from ECR
    // -----------------------------------------------------------------
    const ocrFn = new lambda.DockerImageFunction(this, 'OcrFn', {
      functionName: 'bhoomilens-ocr',
      code: lambda.DockerImageCode.fromEcr(props.ocrEcrRepo, {
        tagOrDigest: 'latest',
      }),
      timeout: Duration.minutes(3),
      memorySize: 3008,
      environment: {
        ...commonEnv,
        OCR_LANGUAGES: 'hi,en',
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.documentsBucket.grantRead(ocrFn, 'raw/*');

    // -----------------------------------------------------------------
    // Extraction Lambda (Bedrock)
    // -----------------------------------------------------------------
    const extractionFn = new lambda.Function(this, 'ExtractionFn', {
      functionName: 'bhoomilens-extract',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.extraction.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    // Grant InvokeModel only on the two model ARNs we actually use.
    extractionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${props.bedrockRegion}::foundation-model/${props.bedrockPrimaryModelId}`,
          `arn:aws:bedrock:${props.bedrockRegion}::foundation-model/${props.bedrockFallbackModelId}`,
          // inference-profile ARNs (some regions require them):
          `arn:aws:bedrock:${props.bedrockRegion}:${this.account}:inference-profile/*`,
        ],
      }),
    );

    // -----------------------------------------------------------------
    // Validation Lambda
    // -----------------------------------------------------------------
    const validationFn = new lambda.Function(this, 'ValidationFn', {
      functionName: 'bhoomilens-validate',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.validation.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(20),
      memorySize: 512,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.referenceTable.grantReadData(validationFn);
    props.recordsTable.grantReadData(validationFn);

    // -----------------------------------------------------------------
    // Persist Lambda — writes the final record row
    // -----------------------------------------------------------------
    const persistFn = new lambda.Function(this, 'PersistFn', {
      functionName: 'bhoomilens-persist',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'backend.lambdas.persist.handler.handler',
      code: backendCodeAsset,
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: commonEnv,
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });
    props.recordsTable.grantReadWriteData(persistFn);
    props.auditTable.grantWriteData(persistFn);

    // -----------------------------------------------------------------
    // State machine
    // -----------------------------------------------------------------
    const invokeGetMetadata = new tasks.LambdaInvoke(this, 'GetMetadata', {
      lambdaFunction: getMetadataFn,
      outputPath: '$.Payload',
    });

    const invokeOcr = new tasks.LambdaInvoke(this, 'RunOcr', {
      lambdaFunction: ocrFn,
      resultPath: '$.ocr',
      payloadResponseOnly: true,
      retryOnServiceExceptions: true,
    }).addRetry({ maxAttempts: 2, interval: Duration.seconds(2), backoffRate: 2 });

    const invokeExtraction = new tasks.LambdaInvoke(this, 'BedrockExtract', {
      lambdaFunction: extractionFn,
      resultPath: '$.extraction',
      payloadResponseOnly: true,
    }).addRetry({
      errors: ['States.TaskFailed', 'ThrottlingException'],
      maxAttempts: 3,
      interval: Duration.seconds(2),
      backoffRate: 2,
    });

    const invokeValidation = new tasks.LambdaInvoke(this, 'Validate', {
      lambdaFunction: validationFn,
      resultPath: '$.validation',
      payloadResponseOnly: true,
    });

    const invokePersist = new tasks.LambdaInvoke(this, 'Persist', {
      lambdaFunction: persistFn,
      resultPath: '$.persisted',
      payloadResponseOnly: true,
    });

    const definition = invokeGetMetadata
      .next(invokeOcr)
      .next(invokeExtraction)
      .next(invokeValidation)
      .next(invokePersist);

    const sfnLogGroup = new logs.LogGroup(this, 'StateMachineLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
    });

    this.stateMachine = new sfn.StateMachine(this, 'IngestionStateMachine', {
      stateMachineName: 'bhoomilens-ingest',
      stateMachineType: sfn.StateMachineType.EXPRESS,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.minutes(5),
      logs: {
        destination: sfnLogGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: false,
    });

    // -----------------------------------------------------------------
    // EventBridge: S3 ObjectCreated on raw/ prefix → SFN
    // -----------------------------------------------------------------
    new events.Rule(this, 'S3UploadRule', {
      ruleName: 'bhoomilens-s3-upload',
      description: 'Trigger BhoomiLens ingest on new document upload',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.documentsBucket.bucketName] },
          object: { key: [{ prefix: 'raw/' }] },
        },
      },
      targets: [
        new targets.SfnStateMachine(this.stateMachine, {
          input: events.RuleTargetInput.fromObject({
            bucket: events.EventField.fromPath('$.detail.bucket.name'),
            key: events.EventField.fromPath('$.detail.object.key'),
            size: events.EventField.fromPath('$.detail.object.size'),
            eventTime: events.EventField.fromPath('$.time'),
          }),
        }),
      ],
    });

    new CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}

