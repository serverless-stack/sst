/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## T3 Stack in AWS
 *
 * Deploy [T3 stack](https://create.t3.gg) with Drizzle and Postgres to AWS.
 *
 * This example was created using `create-t3-app` and the following options: tRPC, Drizzle,
 * no auth, Tailwind, Postgres, and the App Router.
 *
 * Instead of a local database, we'll be using an RDS Postgres database.
 *
 * ```ts title="src/server/db/index.ts" {2-6}
 * const pool = new Pool({
 *   host: Resource.MyPostgres.host,
 *   port: Resource.MyPostgres.port,
 *   user: Resource.MyPostgres.username,
 *   password: Resource.MyPostgres.password,
 *   database: Resource.MyPostgres.database,
 * });
 * ```
 *
 * Similarly, for Drizzle Kit.
 *
 * ```ts title="drizzle.config.ts" {8-12}
 * export default {
 *   schema: "./src/server/db/schema.ts",
 *   dialect: "postgresql",
 *   dbCredentials: {
 *     ssl: {
 *       rejectUnauthorized: false,
 *     },
 *     host: Resource.MyPostgres.host,
 *     port: Resource.MyPostgres.port,
 *     user: Resource.MyPostgres.username,
 *     password: Resource.MyPostgres.password,
 *     database: Resource.MyPostgres.database,
 *   },
 *   tablesFilter: ["aws-t3_*"],
 * } satisfies Config;
 * ```
 *
 * In our Next.js app we can access our Postgres database because we [link them](/docs/linking/)
 * both. We don't need to use our `.env` files.
 *
 * ```ts title="sst.config.ts" {5}
 *  const rds = new sst.aws.Postgres("MyPostgres", { vpc, proxy: true });
 *
 *  new sst.aws.Nextjs("MyWeb", {
 *    vpc,
 *    link: [rds]
 *  });
 * ```
 *
 * To run this in dev mode run:
 *
 * ```bash
 * npm install
 * npx sst dev
 * ```
 *
 * It'll take a few minutes to deploy the database and the VPC.
 *
 * This also starts a tunnel to let your local machine connect to the RDS Postgres database.
 * Make sure you have it installed, you only need to do this once for your local machine.
 *
 * ```bash
 * sudo npx sst tunnel install
 * ```
 *
 * Now in a new terminal you can run the database migrations.
 *
 * ```bash
 * npm run db:push
 * ```
 *
 * We also have the Drizzle Studio start automatically in dev mode under the **Studio** tab.
 *
 * ```ts title="sst.config.ts"
 * new sst.x.DevCommand("Studio", {
 *   link: [rds],
 *   dev: {
 *     command: "npx drizzle-kit studio",
 *   },
 * });
 * ```
 *
 * And to make sure our credentials are available, we update our `package.json`
 * with the [`sst shell`](/docs/reference/cli) CLI.
 *
 * ```json title="package.json"
 * "db:generate": "sst shell drizzle-kit generate",
 * "db:migrate": "sst shell drizzle-kit migrate",
 * "db:push": "sst shell drizzle-kit push",
 * "db:studio": "sst shell drizzle-kit studio",
 * ```
 *
 * So running `npm run db:push` will run Drizzle Kit with the right credentials.
 *
 * To deploy this to production run:
 *
 * ```bash
 * npx sst deploy --stage production
 * ```
 *
 * Then run the migrations.
 *
 * ```bash
 * npx sst shell --stage production npx drizzle-kit push
 * ```
 *
 * If you are running this locally, you'll need to have a tunnel running.
 *
 * ```bash
 * npx sst tunnel --stage production
 * ```
 *
 * If you are doing this in a CI/CD pipeline, you'd want your build containers to be in the
 * same VPC.
 */
export default $config({
  app(input) {
    return {
      name: "aws-t3",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { bastion: true, nat: "ec2" });
    const rds = new sst.aws.Postgres("MyPostgres", { vpc, proxy: true });

    new sst.aws.Nextjs("MyWeb", {
      vpc,
      link: [rds]
    });

    new sst.x.DevCommand("Studio", {
      link: [rds],
      dev: {
        command: "npx drizzle-kit studio",
      },
    });
  },
});
