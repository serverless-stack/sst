/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-astro-container",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc");
    const bucket = new sst.aws.Bucket("MyBucket", {
      access: "public"
    });

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });

    cluster.addService("MyService", {
      link: [bucket],
      loadBalancer: {
        ports: [{ listen: "80/http", forward: "4321/http" }],
      },
      dev: {
        command: "npm run dev",
      },
    });
  }
});
