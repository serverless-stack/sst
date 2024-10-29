/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "aws-rails",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket", {
      access: "public",
    });
    const vpc = new sst.aws.Vpc("MyVpc");

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    cluster.addService("MyService", {
      loadBalancer: {
        ports: [{ listen: "80/http", forward: "3000/http" }],
      },
      environment: {
        RAILS_MASTER_KEY: (await import("fs")).readFileSync(
          "config/master.key",
          "utf8",
        ),
      },
      dev: {
        command: "bin/rails server",
      },
      link: [bucket],
    });
    return { vpc: vpc.id };
  },
});
