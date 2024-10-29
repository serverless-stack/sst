/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-rust-cluster",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: { region: "us-east-1" },
      },
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { nat: "gateway" });
    const cluster = new sst.aws.Cluster("MyCluster", { vpc });

    const service = cluster.addService("MyService", {
      image: {
        context: "./",
        dockerfile: "Dockerfile",
      },
      loadBalancer: {
        domain: "rust.dockerfile.dev.sst.dev",
        ports: [
          { listen: "80/http" },
          { listen: "443/https", forward: "80/http" },
        ],
      },
    });

    return {
      url: service.url,
    };
  },
});
