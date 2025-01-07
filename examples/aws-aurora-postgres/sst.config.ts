/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Aurora Postgres
 *
 * In this example, we deploy a Aurora Postgres database.
 *
 * ```ts title="sst.config.ts"
 * const postgres = new sst.aws.Aurora("MyDatabase", {
 *   engine: "postgres",
 *   vpc,
 * });
 * ```
 *
 * And link it to a Lambda function.
 *
 * ```ts title="sst.config.ts" {4}
 * new sst.aws.Function("MyApp", {
 *   handler: "index.handler",
 *   link: [postgres],
 *   url: true,
 *   vpc,
 * });
 * ```
 *
 * In the function we use the [`postgres`](https://www.npmjs.com/package/postgres) package.
 *
 * ```ts title="index.ts"
 * import postgres from "postgres";
 * import { Resource } from "sst";
 *
 * const sql = postgres({
 *   username: Resource.MyDatabase.username,
 *   password: Resource.MyDatabase.password,
 *   database: Resource.MyDatabase.database,
 *   host: Resource.MyDatabase.host,
 *   port: Resource.MyDatabase.port,
 * });
 * ```
 *
 * We also enable the `bastion` option for the VPC. This allows us to connect to the database
 * from our local machine with the `sst tunnel` CLI.
 *
 * ```bash "sudo"
 * sudo npx sst tunnel install
 * ```
 *
 * This needs _sudo_ to create a network interface on your machine. You’ll only need to do this
 * once on your machine.
 *
 * Now you can run `npx sst dev` and you can connect to the database from your local machine.
 *
 */
export default $config({
  app(input) {
    return {
      name: "aws-aurora-postgres",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", {
      nat: "ec2",
      bastion: true,
    });
    const postgres = new sst.aws.Aurora("MyDatabase", {
      engine: "postgres",
      vpc,
    });
    new sst.aws.Function("MyApp", {
      handler: "index.handler",
      link: [postgres],
      url: true,
      vpc,
    });

    return {
      host: postgres.host,
      port: postgres.port,
      username: postgres.username,
      password: postgres.password,
      database: postgres.database,
    };
  },
});
