/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Task Cron
 *
 * Use the [`Task`](/docs/component/aws/task) and [`Cron`](/docs/component/aws/cron) components
 * for long running background tasks.
 *
 * We have a node script that we want to run in `index.mjs`. It'll be deployed as a
 * Docker container using `Dockerfile`.
 *
 * It'll be invoked by a cron job that runs every 2 minutes.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Cron("MyCron", {
 *   task,
 *   schedule: "rate(2 minutes)"
 * });
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
      name: "aws-task-cron",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket");
    const vpc = new sst.aws.Vpc("MyVpc");

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    const task = cluster.addTask("MyTask", {
      link: [bucket],
      dev: {
        command: "node index.mjs",
      },
    });

    new sst.aws.Cron("MyCron", {
      task,
      schedule: "rate(2 minutes)",
    });
  },
});
