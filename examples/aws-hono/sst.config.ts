/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-hono",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket");
    new sst.aws.Function("Hono", {
      url: true,
      link: [bucket],
      handler: "src/index.handler",
    });
  },
});
