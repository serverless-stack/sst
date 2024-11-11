/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Postgres local
 *
 * In this example, we use a local Docker Postgres instance for dev. While on deploy, we are
 * using RDS.
 *
 * We use the [Pulumi Docker provider](https://www.pulumi.com/registry/packages/docker/) to
 * create a local container with Postgres when running `sst dev`.
 *
 * ```ts title="sst.config.ts"
 * if ($dev) {
 *   new docker.Container("LocalPostgres", {
 *     name: `postgres-${$app.name}`,
 *     restart: "always",
 *     image: "postgres:16.4",
 *     ports: [{
 *       internal: 5432,
 *       external: port,
 *     }],
 *     envs: [
 *       `POSTGRES_PASSWORD=${password}`,
 *       `POSTGRES_USER=${username}`,
 *       `POSTGRES_DB=${database}`,
 *     ],
 *     volumes: [{
 *       hostPath: "/tmp/postgres-data",
 *       containerPath: "/var/lib/postgresql/data",
 *     }],
 *   });
 * }
 * ```
 *
 * We then use the `Linkable` component to expose the credentials.
 *
 * ```ts title="sst.config.ts"
 * local = new sst.Linkable("MyPostgres", {
 *   properties: {
 *     host: "localhost",
 *     port,
 *     username,
 *     password,
 *     database,
 *   },
 * });
 * ```
 *
 * On deploy, we create a Postgres RDS database. And we conditionally link the database to our
 * Lambda function.
 *
 * ```ts title="sst.config.ts" {4}
 * new sst.aws.Function("MyFunction", {
 *   url: true,
 *   handler: "index.handler",
 *   link: [$dev ? local : rds],
 *   vpc: $dev ? undefined : vpc,
 * });
 * ```
 *
 * Our Lambda function connects to the right database through the link.
 *
 * ```ts title="index.ts"
 * const pool = new Pool({
 *   host: Resource.MyPostgres.host,
 *   port: Resource.MyPostgres.port,
 *   user: Resource.MyPostgres.username,
 *   password: Resource.MyPostgres.password,
 *   database: Resource.MyPostgres.database,
 * });
 * ```
 *
 * Finally, when we run `sst remove`, the local Postgres container is also removed.
 */
export default $config({
  app(input) {
    return {
      name: "aws-postgres-local",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: { docker: "4.5.7" },
    };
  },
  async run() {
    let vpc, rds, local;

    if ($dev) {
      const password = "password";
      const username = "postgres";
      const database = "local";
      const port = 5432;

      new docker.Container("LocalPostgres", {
        // Unique container name
        name: `postgres-${$app.name}`,
        restart: "always",
        image: "postgres:16.4",
        ports: [{
          internal: 5432,
          external: port,
        }],
        envs: [
          `POSTGRES_PASSWORD=${password}`,
          `POSTGRES_USER=${username}`,
          `POSTGRES_DB=${database}`,
        ],
        volumes: [{
          // Where to store the data locally
          hostPath: "/tmp/postgres-data",
          containerPath: "/var/lib/postgresql/data",
        }],
      });
      local = new sst.Linkable("MyPostgres", {
        properties: {
          host: "localhost",
          port,
          username,
          password,
          database,
        },
      });
    }
    else {
      vpc = new sst.aws.Vpc("MyVpc", { bastion: true, nat: "ec2" });
      rds = new sst.aws.Postgres("MyPostgres", { vpc });
    }

    new sst.aws.Function("MyFunction", {
      url: true,
      handler: "index.handler",
      link: [$dev ? local : rds],
      vpc: $dev ? undefined : vpc,
    });
  },
});
