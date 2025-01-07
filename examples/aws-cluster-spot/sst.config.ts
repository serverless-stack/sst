/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-cluster-spot",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc");

    // Create a cluster and use Fargate spot instances
    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    cluster.addService("MyService", {
      loadBalancer: {
        ports: [{ listen: "80/http" }],
      },
      capacity: "spot",
    });
  },
});
