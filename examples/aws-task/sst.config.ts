/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-task",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", {
      nat: "ec2",
    });
    const bucket = new sst.aws.Bucket("MyBucket");
    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    const task = cluster.addTask("MyTask", {
      image: {
        context: "image",
      },
      link: [bucket],
      dev: {
        command: "bun index.mjs",
        directory: "image",
      },
    });

    new sst.aws.Function("MyApp", {
      handler: "index.handler",
      url: true,
      vpc,
      link: [task],
    });
  },
});
