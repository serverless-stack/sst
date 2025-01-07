/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Postgres local
 *
 * In this example, we connect to a locally running Postgres instance for dev. While
 * on deploy, we use RDS.
 *
 * We use the [`docker run`](https://docs.docker.com/reference/cli/docker/container/run/) CLI
 * to start a local container with Postgres. You don't have to use Docker, you can use
 * Postgres.app or any other way to run Postgres locally.
 *
 * ```bash
 * docker run \
 *   --rm \
 *   -p 5432:5432 \
 *   -v $(pwd)/.sst/storage/postgres:/var/lib/postgresql/data \
 *   -e POSTGRES_USER=postgres \
 *   -e POSTGRES_PASSWORD=password \
 *   -e POSTGRES_DB=local \
 *   postgres:16.4
 * ```
 *
 * The data is saved to the `.sst/storage` directory. So if you restart the dev server, the
 * data will still be there.
 *
 * We then configure the `dev` property of the `Postgres` component with the settings for the
 * local Postgres instance.
 *
 * ```ts title="sst.config.ts"
 * dev: {
 *   username: "postgres",
 *   password: "password",
 *   database: "local",
 *   port: 5432,
 * }
 * ```
 *
 * By providing the `dev` prop for Postgres, SST will use the local Postgres instance and
 * not deploy a new RDS database when running `sst dev`.
 *
 * It also allows us to access the database through a Reosurce `link` without having to
 * conditionally check if we are running locally.
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
 * The above will work in both `sst dev` and `sst deploy`.
 */
export default $config({
  app(input) {
    return {
      name: "aws-postgres-local",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { nat: "ec2" });

    const rds = new sst.aws.Postgres("MyPostgres", {
      dev: {
        username: "postgres",
        password: "password",
        database: "local",
        host: "localhost",
        port: 5432,
      },
      vpc,
    });

    new sst.aws.Function("MyFunction", {
      vpc,
      url: true,
      link: [rds],
      handler: "index.handler",
    });
  },
});
