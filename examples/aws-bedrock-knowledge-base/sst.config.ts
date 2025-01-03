/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Bedrock Knowledge Base
 *
 * This example demonstrates how to create a Knowledge Base using RDS as vector storage
 * and S3 as data source.
 *
 * :::tip
 * You must create the table in RDS before deploying the knowledge base.
 * :::
 *
 * :::tip
 * You must install the SST tunnel
 * :::
 *
 * After deploying the Vpc, and RDS, login to the DB and setup the table:
 *
 * ```sql title="psql shell"
 * CREATE EXTENSION IF NOT EXISTS vector;
 * CREATE SCHEMA bedrock_integration;
 * CREATE TABLE bedrock_integration.bedrock_kb (
 *   id uuid PRIMARY KEY,
 *   chunks text,
 *   embedding vector(1024),
 *   metadata json
 * );
 * CREATE INDEX ON bedrock_integration.bedrock_kb USING hnsw (embedding vector_cosine_ops) WITH (ef_constructino=256);
 * ```
 *
 * Then deploy the knowledge base.
 */
export default $config({
  app(input) {
    return {
      name: "aws-bedrock-knowledge-base",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("Vpc", {
      nat: "ec2",
      bastion: true, // so you can connect to RDS and setup the table
    });

    const rds = new sst.aws.Aurora("Rds", {
      dataApi: true, // required for Bedrock KnowledgeBase to access RDS
      engine: "postgres",
      vpc: vpc,
      scaling: {
        min: "0.5 ACU", // set min so the KnowledgeBase DataSource can be synced without errors
      },
    });

    // NOTE: before deploying the knowledge base, you must create the table in RDS.
    // See README.md for more information.

    // anything in the bucket will be indexed by the knowledge base
    // see (Supported document formats)[https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-ds.html#kb-ds-supported-doc-formats-limits]
    const knowledgeBaseBucket = new sst.aws.Bucket("KnowledgeBaseBucket");

    // See (Knowledge Base Service Role)[https://docs.aws.amazon.com/bedrock/latest/userguide/kb-permissions.html]
    const knowledgeBaseRole = new aws.iam.Role("KnowledgeBaseRole", {
      assumeRolePolicy: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "bedrock.amazonaws.com",
            },
            Action: "sts:AssumeRole",
            Condition: {
              StringEquals: {
                "aws:SourceAccount": aws.getCallerIdentityOutput({}).accountId,
              },
            },
          },
        ],
      },
      inlinePolicies: [
        {
          name: "KnowledgeBasePolicy",
          policy: aws.getRegionOutput().name.apply((region) =>
            JSON.stringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Sid: "ListFoundationModels",
                  Effect: "Allow",
                  Action: [
                    "bedrock:ListFoundationModels",
                    "bedrock:ListCustomModels",
                  ],
                  Resource: "*",
                },
                {
                  Sid: "InvokeModels",
                  Effect: "Allow",
                  Action: ["bedrock:InvokeModel"],
                  Resource: [
                    `arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`,
                  ],
                },
              ],
            }),
          ),
        },
        {
          name: "KnowledgeBaseBucketAccessPolicy",
          policy: $resolve(knowledgeBaseBucket.arn).apply((arn) =>
            JSON.stringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: ["s3:GetObject", "s3:ListBucket"],
                  Resource: [arn, `${arn}/*`],
                },
              ],
            }),
          ),
        },
        {
          name: "KnowledgeBaseRDSAccessPolicy",
          policy: $resolve([rds.clusterArn, rds.secretArn]).apply(
            ([clusterArn, secretArn]) =>
              JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "RDSDescribe",
                    Effect: "Allow",
                    Action: ["rds:DescribeDBClusters"],
                    Resource: [clusterArn],
                  },
                  {
                    Sid: "RDSDataApiAccess",
                    Effect: "Allow",
                    Action: [
                      "rds-data:BatchExecuteStatement",
                      "rds-data:ExecuteStatement",
                    ],
                    Resource: [clusterArn],
                  },
                  {
                    Sid: "SecretsManagerAccess",
                    Effect: "Allow",
                    Action: ["secretsmanager:GetSecretValue"],
                    Resource: [secretArn],
                  },
                ],
              }),
          ),
        },
      ],
    });

    // create the knowledge base
    const knowledgeBase = new aws.bedrock.AgentKnowledgeBase("KnowledgeBase", {
      name: `${$app.name}-${$app.stage}-knowledge-base`,
      description: `Knowledge base for ${$app.name} ${$app.stage}`,
      storageConfiguration: {
        type: "RDS",
        rdsConfiguration: {
          databaseName: rds.database,
          credentialsSecretArn: rds.secretArn,
          resourceArn: rds.clusterArn,
          tableName: "bedrock_integration.bedrock_kb", // make sure this table exists in the RDS
          fieldMapping: {
            primaryKeyField: "id",
            textField: "chunks",
            vectorField: "embedding",
            metadataField: "metadata",
          },
        },
      },
      roleArn: knowledgeBaseRole.arn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: aws
            .getRegionOutput()
            .name.apply(
              (region) =>
                `arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`,
            ),
        },
      },
    });

    // create the s3 data source for the knowledge base
    const s3DataSource = new aws.bedrock.AgentDataSource(
      "KnowledgeBaseS3DataSource",
      {
        knowledgeBaseId: knowledgeBase.id,
        name: `${$app.name}-${$app.stage}-knowledge-base-s3`,
        dataSourceConfiguration: {
          type: "S3",
          s3Configuration: {
            bucketArn: $resolve(knowledgeBaseBucket.arn).apply((arn) => arn),
          },
        },
      },
    );

    return {
      knowledgeBase,
      knowledgeBaseBucket,
      knowledgeBaseRole,
      s3DataSource,
    };
  },
});
