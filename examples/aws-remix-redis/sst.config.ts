/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Remix container with Redis
 *
 * Creates a hit counter app with Remix and Redis.
 *
 * This deploys Remix as a Fargate service to ECS and it's linked to Redis.
 *
 * ```ts title="sst.config.ts" {2}
 * cluster.addService("MyService", {
 *   link: [redis],
 *   loadBalancer: {
 *     ports: [{ listen: "80/http", forward: "3000/http" }],
 *   },
 *   dev: {
 *     command: "npm run dev",
 *   },
 * });
 * ```
 *
 * Since our Redis cluster is in a VPC, we’ll need a tunnel to connect to it from our local
 * machine.
 *
 * ```bash "sudo"
 * sudo npx sst tunnel install
 * ```
 *
 * This needs _sudo_ to create a network interface on your machine. You’ll only need to do this
 * once on your machine.
 *
 * To start your app locally run.
 *
 * ```bash
 * npx sst dev
 * ```
 *
 * Now if you go to `http://localhost:5173` you’ll see a counter update as you refresh the page.
 *
 * Finally, you can deploy it by adding the `Dockerfile` that's included in this example and
 * running `npx sst deploy --stage production`.
 */
export default $config({
  app(input) {
    return {
      name: "aws-remix-remix",
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
        ports: [{ listen: "80/http", forward: "3000/http" }],
      },
      dev: {
        command: "npm run dev",
      },
    });
  },
});
