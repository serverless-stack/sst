/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Deno Redis
 *
 * Creates a hit counter app with Deno and Redis.
 *
 * This deploys Deno as a Fargate service to ECS and it's linked to Redis.
 *
 * ```ts title="sst.config.ts" {2}
 * cluster.addService("MyService", {
 *   link: [redis],
 *   loadBalancer: {
 *     ports: [{ listen: "80/http", forward: "8000/http" }],
 *   },
 *   dev: {
 *     command: "deno task dev",
 *   },
 * });
 * ```
 *
 * Since our Redis cluster is in a VPC, we’ll need a tunnel to connect to it from our local
 * machine.
 *
 * ```bash "sudo"
 * sudo sst tunnel install
 * ```
 *
 * This needs _sudo_ to create a network interface on your machine. You’ll only need to do this
 * once on your machine.
 *
 * To start your app locally run.
 *
 * ```bash
 * sst dev
 * ```
 *
 * Now if you go to `http://localhost:8000` you’ll see a counter update as you refresh the page.
 *
 * Finally, you can deploy it using `sst deploy --stage production` using a `Dockerfile`
 * that's included in the example.
 */
export default $config({
  app(input) {
    return {
      name: "aws-deno",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { bastion: true });
    const redis = new sst.aws.Redis("MyRedis", { vpc });
    const cluster = new sst.aws.Cluster("MyCluster", { vpc });

    cluster.addService("MyService", {
      link: [redis],
      loadBalancer: {
        ports: [{ listen: "80/http", forward: "8000/http" }],
      },
      dev: {
        command: "deno task dev",
      },
    });
  },
});
