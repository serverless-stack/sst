/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Go Lambda DynamoDB
 *
 * An example on how to use a Go runtime Lambda with DynamoDB.
 *
 * You configure the DynamoDB client.
 *
 * ```go title="src/main.go"
 * import (
 *   "github.com/sst/sst/v3/sdk/golang/resource"
 * )
 *
 * func main() {
 *   cfg, err := config.LoadDefaultConfig(context.Background())
 *  if err != nil {
 *    panic(err)
 *  }
 *  client := dynamodb.NewFromConfig(cfg)
 *
 *
 *  tableName, err := resource.Get("Table", "name")
 *  if err != nil {
 *    panic(err)
 *  }
 * }
 * ```
 *
 * And make a request to DynamoDB.
 *
 * ```go title="src/main.go"
 * _, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
 *   TableName: tableName.(string),
 *	 Item:      item,
 * })
 * ```
 *
 */
export default $config({
  app(input) {
    return {
      name: "sst-go-lambda-dynamo",
      removal: "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-2",
        },
      },
    };
  },
  async run() {
    const table = new sst.aws.Dynamo("Table", {
      fields: {
        PK: "string",
        SK: "string",
      },
      primaryIndex: { hashKey: "PK", rangeKey: "SK" },
    });

    new sst.aws.Function("GoFunction", {
      url: true,
      runtime: "go",
      handler: "./src",
      link: [table],
    });
  },
});
