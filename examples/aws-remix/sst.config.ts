/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-remix",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket", {
      access: "public"
    });
    new sst.aws.Remix("MyWeb", {
      link: [bucket],
    });
  },
});
