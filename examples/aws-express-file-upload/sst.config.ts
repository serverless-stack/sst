/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Express file upload
 *
 * Deploys an Express app to AWS.
 *
 * You can get started by running.
 *
 * ```bash
 * mkdir aws-express-file-upload && cd aws-express-file-upload
 * npm init -y
 * npm install express
 * npx sst@latest init
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
 *     command: "node --watch index.mjs",
 *   },
 * });
 * ```
 *
 * Start your app locally.
 *
 * ```bash
 * npx sst dev
 * ```
 *
 * This example lets you upload a file to S3 and then download it.
 *
 * ```bash
 * curl -F file=@package.json http://localhost:80/
 * curl http://localhost:80/latest
 * ```
 *
 * Finally, you can deploy it using `npx sst deploy --stage production`.
 */
export default $config({
  app(input) {
    return {
      name: "aws-express-file-upload",
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
        ports: [{ listen: "80/http" }],
      },
      dev: {
        command: "node --watch index.mjs",
      },
      link: [bucket],
    });
  },
});
