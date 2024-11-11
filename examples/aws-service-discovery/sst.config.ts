/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Cluster Service Discovery
 * 
 * In this example, we are connecting to a service running on a cluster using its AWS Cloud
 * Map service host name. This is useful for service discovery.
 *
 * We are deploying a service to a cluster in a VPC. And we can access it within the VPC using
 * the service's cloud map hostname.
 *
 * ```ts title="lambda.ts"
 * const reponse = await fetch(`http://${Resource.MyService.service}`);
 * ```
 *
 * Here we are accessing it through a Lambda function that's linked to the service and is
 * deployed to the same VPC.
 */
export default $config({
  app(input) {
    return {
      name: "aws-service-discovery",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { nat: "ec2" });

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    const service = cluster.addService("MyService");

    new sst.aws.Function("MyFunction", {
      vpc,
      url: true,
      link: [service],
      handler: "lambda.handler",
    });
  },
});
