/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Cluster with API Gateway
 *
 * Expose a service through API Gateway HTTP API using a VPC link.
 *
 * This is an alternative to using a load balancer. Since API Gateway is pay per request, it
 * works out a lot cheaper for services that don't get a lot of traffic.
 *
 * You need to specify which port in your service will be exposed through API Gateway.
 *
 * ```ts title="sst.config.ts" {3}
 * const service = cluster.addService("MyService", {
 *   serviceRegistry: {
 *     port: 80,
 *   },
 * });
 * ```
 *
 * Your API Gateway HTTP API also needs to be in the same VPC as the service.
 */
export default $config({
  app(input) {
    return {
      name: "aws-cluster-vpclink",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc");
    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    const service = cluster.addService("MyService", {
      serviceRegistry: {
        port: 80,
      },
    });

    const api = new sst.aws.ApiGatewayV2("MyApi", { vpc });
    api.routePrivate("$default", service.nodes.cloudmapService.arn);
  },
});
