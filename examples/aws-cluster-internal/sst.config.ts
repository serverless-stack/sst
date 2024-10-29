/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Cluster private service
 *
 * Adds a private load balancer to a service by setting the `loadBalancer.public` prop to
 * `false`.
 *
 * This allows you to create internal services that can only be accessed inside a VPC.
 */
export default $config({
  app(input) {
    return {
      name: "aws-cluster-internal",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { bastion: true });

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    cluster.addService("MyService", {
      loadBalancer: {
        public: false,
        ports: [{ listen: "80/http" }],
      },
    });
  },
});
