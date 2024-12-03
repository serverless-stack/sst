/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Bun Redis
 *
 * Creates a hit counter app with Bun and Redis.
 *
 * This deploys Bun as a Fargate service to ECS and it's linked to Redis.
 *
 * ```ts title="sst.config.ts" {8}
 * cluster.addService("MyService", {
 *   loadBalancer: {
 *     ports: [{ listen: "80/http", forward: "3000/http" }],
 *   },
 *   dev: {
 *     command: "bun dev",
 *   },
 *   link: [redis],
 * });
 * ```
 *
 * We also have a couple of scripts. A `dev` script with a watcher and a `build` script
 * that used when we deploy to production.
 *
 * ```json title="package.json"
 * {
 *   "scripts": {
 *     "dev": "bun run --watch index.ts",
 *     "build": "bun build --target bun index.ts"
 *   },
 * }
 * ```
 *
 * Since our Redis cluster is in a VPC, we’ll need a tunnel to connect to it from our local
 * machine.
 *
 * ```bash "sudo"
 * sudo bun sst tunnel install
 * ```
 *
 * This needs _sudo_ to create a network interface on your machine. You’ll only need to do this
 * once on your machine.
 *
 * To start your app locally run.
 *
 * ```bash
 * bun sst dev
 * ```
 *
 * Now if you go to `http://localhost:3000` you’ll see a counter update as you refresh the page.
 *
 * Finally, you can deploy it using `bun sst deploy --stage production` using a `Dockerfile`
 * that's included in the example.
 */
export default $config({
  app(input) {
    return {
      name: "aws-bun-redis",
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
        command: "bun dev",
      },
    });
  },
});
