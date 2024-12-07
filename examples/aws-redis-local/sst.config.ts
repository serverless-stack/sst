/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Redis local
 *
 * In this example, we connect to a local Docker Redis instance for dev. While on deploy, we use
 * Redis ElastiCache.
 *
 * We use the [`docker run`](https://docs.docker.com/reference/cli/docker/container/run/) CLI
 * to start a local Redis server. You don't have to use Docker, you can run it locally any way
 * you want.
 *
 * ```bash
 * docker run \
 *   --rm \
 *   -p 6379:6379 \
 *   -v $(pwd)/.sst/storage/redis:/data \
 *   redis:latest
 * ```
 *
 * The data is persisted to the `.sst/storage` directory. So if you restart the dev server,
 * the data will still be there.
 *
 * We then configure the `dev` property of the Redis component with the settings for the
 * local Redis server.
 *
 * ```ts title="sst.config.ts"
 * dev: {
 *   host: "localhost",
 *   port: 6379
 * }
 * ```
 *
 * By providing the `dev` prop for Redis, SST will use the local Redis server and
 * not deploy a new Redis ElastiCache cluster when running `sst dev`.
 *
 * It also allows us to access Redis through a Reosurce `link`.
 *
 * ```ts title="index.ts"
 * const client = Resource.MyRedis.host === "localhost"
 *   ? new Redis({
 *       host: Resource.MyRedis.host,
 *       port: Resource.MyRedis.port,
 *     })
 *   : new Cluster(
 *       [{ 
 *         host: Resource.MyRedis.host,
 *         port: Resource.MyRedis.port,
 *       }],
 *       {
 *         redisOptions: {
 *           tls: { checkServerIdentity: () => undefined },
 *           username: Resource.MyRedis.username,
 *           password: Resource.MyRedis.password,
 *         },
 *       },
 *     );
 * ```
 *
 * The local Redis server is running in `standalone` mode, whereas on deploy it'll be in
 * `cluster` mode. So our Lambda function needs to connect using the right config.
 */
export default $config({
  app(input) {
    return {
      name: "aws-redis-local",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { nat: "managed" });

    const redis = new sst.aws.Redis("MyRedis", {
      dev: {
        host: "localhost",
        port: 6379,
      },
      vpc,
    });

    new sst.aws.Function("MyApp", {
      vpc,
      url: true,
      link: [redis],
      handler: "index.handler",
    });
  },
});
