/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS EFS
 *
 * Mount an EFS file system to a function and a container.
 *
 * This allows both your function and the container to access the same file system. Here they
 * both update a counter that's stored in the file system.
 *
 * ```js title="common.mjs"
 * await writeFile("/mnt/efs/counter", newValue.toString());
 * ```
 *
 * The file system is mounted to `/mnt/efs` in both the function and the container.
 */
export default $config({
  app(input) {
    return {
      name: "aws-efs",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    // NAT Gateways are required for Lambda functions
    const vpc = new sst.aws.Vpc("MyVpc", { nat: "managed" });

    // Create an EFS file system to store a counter
    const efs = new sst.aws.Efs("MyEfs", { vpc });

    // Create a Lambda function that increments the counter
    new sst.aws.Function("MyFunction", {
      handler: "lambda.handler",
      url: true,
      vpc,
      volume: {
        efs,
        path: "/mnt/efs",
      },
    });

    // Create a service that increments the same counter
    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    cluster.addService("MyService", {
      loadBalancer: {
        ports: [{ listen: "80/http" }],
      },
      volumes: [
        {
          efs,
          path: "/mnt/efs",
        },
      ],
    });
  },
});
