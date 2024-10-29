/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Bun file upload
 *
 * Deploys an Bun app to AWS.
 *
 * You can get started by running.
 *
 * ```bash
 * mkdir aws-bun-file-upload && cd aws-bun-file-upload
 * bun init -y
 * bunx sst init
 * ```
 *
 * Now you can add a service.
 *
 * ```ts title="sst.config.ts"
 * cluster.addService("MyService", {
 *   loadBalancer: {
 *     ports: [{ listen: "80/http", forward: "3000/http" }],
 *   },
 *   dev: {
 *     command: "bun dev",
 *   },
 *   link: [bucket],
 * });
 * ```
 *
 * Start your app locally.
 *
 * ```bash
 * bun sst dev
 * ```
 *
 * This example lets you upload a file to S3 and then download it.
 *
 * ```bash
 * curl -F file=@package.json http://localhost:3000/
 * curl http://localhost:3000/latest
 * ```
 *
 * Finally, you can deploy it using `bun sst deploy --stage production`.
 */
export default $config({
  app(input) {
    return {
      name: "aws-bun-file-upload",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket");
    const vpc = new sst.aws.Vpc("MyVpc");

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    cluster.addService("MyService", {
      loadBalancer: {
        ports: [{ listen: "80/http", forward: "3000/http" }],
      },
      dev: {
        command: "bun dev",
      },
      link: [bucket],
    });
  },
});
