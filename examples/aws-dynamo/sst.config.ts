/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## DynamoDB streams
 *
 * Create a DynamoDB table, enable streams, and subscribe to it with a function.
 */
export default $config({
  app(input) {
    return {
      name: "aws-dynamo",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const table = new sst.aws.Dynamo("MyTable", {
      fields: {
        id: "string",
      },
      primaryIndex: { hashKey: "id" },
      stream: "new-and-old-images",
    });
    table.subscribe("MySubscriber", "subscriber.handler", {
      filters: [
        {
          dynamodb: {
            NewImage: {
              message: {
                S: ["Hello"],
              },
            },
          },
        },
      ],
    });

    const app = new sst.aws.Function("MyApp", {
      handler: "publisher.handler",
      link: [table],
      url: true,
    });

    return {
      app: app.url,
      table: table.name,
    };
  },
});
