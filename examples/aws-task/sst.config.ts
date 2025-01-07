/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Task
 *
 * Use the [`Task`](/docs/component/aws/task) component to run background tasks.
 *
 * We have a node script that we want to run in `image/index.mjs`. It'll be deployed as a
 * Docker container using `image/Dockerfile`.
 *
 * We also have a function that the task is linked to. It uses the [SDK](/docs/reference/sdk/)
 * to start the task.
 *
 * ```ts title="index.ts" {5}
 * import { Resource } from "sst";
 * import { task } from "sst/aws/task";
 *
 * export const handler = async () => {
 *   const ret = await task.run(Resource.MyTask);
 *   return {
 *     statusCode: 200,
 *     body: JSON.stringify(ret, null, 2),
 *   };
 * };
 * ```
 *
 * When this is run in `sst dev`, the task is executed locally using `dev.command`.
 *
 * ```ts title="sst.config.ts"
 * dev: {
 *   command: "node index.mjs"
 * }
 * ```
 *
 * To deploy, you need the Docker daemon running.
 */
export default $config({
  app(input) {
    return {
      name: "aws-task",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket");
    const vpc = new sst.aws.Vpc("MyVpc", { nat: "ec2" });

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });

    const task = cluster.addTask("MyTask", {
      link: [bucket],
      image: {
        context: "image",
      },
      dev: {
        command: "node index.mjs",
      },
    });

    new sst.aws.Function("MyApp", {
      vpc,
      url: true,
      link: [task],
      handler: "index.handler",
    });
  },
});
