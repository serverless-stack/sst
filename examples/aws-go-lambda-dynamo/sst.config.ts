/// <reference path="./.sst/platform/config.d.ts" />

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
