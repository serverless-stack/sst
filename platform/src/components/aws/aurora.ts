import {
  all,
  ComponentResourceOptions,
  interpolate,
  jsonStringify,
  output,
  Output,
} from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component.js";
import { Link } from "../link.js";
import { Input } from "../input.js";
import { iam, rds, secretsmanager } from "@pulumi/aws";
import { VisibleError } from "../error.js";
import { Vpc } from "./vpc.js";
import { RandomPassword } from "@pulumi/random";
import { DevCommand } from "../experimental/dev-command.js";
import { RdsRoleLookup } from "./providers/rds-role-lookup.js";
import { DurationHours, toSeconds } from "../duration.js";

type ACU = `${number} ACU`;

function parseACU(acu: ACU) {
  const result = parseFloat(acu.split(" ")[0]);
  return result;
}

export interface AuroraArgs {
  /**
   * The Aurora engine to use.
   *
   * @example
   * ```js
   * {
   *   engine: "postgres"
   * }
   * ```
   */
  engine: Input<"postgres" | "mysql">;
  /**
   * The version of the Aurora engine.
   *
   * The default is `"16.4"` for `"postgres"` and `"3.08.0"` for `"mysql"`.
   *
   * Check out the [available `"postgres"` versions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html#Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.apg) and [available `"mysql"` versions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.html#Concepts.Aurora_Fea_Regions_DB-eng.Feature.ServerlessV2.amy) in your region.
   *
   * Note that not all versions support scaling to 0 with auto-pause and resume. The supported versions are:
   * - Aurora PostgresSQL 16.3 and higher
   * - Aurora PostgresSQL 15.7 and higher
   * - Aurora PostgresSQL 14.12 and higher
   * - Aurora PostgresSQL 13.15 and higher
   * - Aurora MySQL 3.08.0 and higher
   *
   * @default `"16.4"` for `"postgres"`, `"3.08.0"` for `"mysql"`
   * @example
   * ```js
   * {
   *   version: "16.3"
   * }
   * ```
   */
  version?: Input<string>;
  /**
   * The username of the master user.
   *
   * :::caution
   * Changing the username will cause the database to be destroyed and recreated.
   * :::
   *
   * @default `"postgres"` for `"postgres"`, `"root"` for `"mysql"`
   * @example
   * ```js
   * {
   *   username: "admin"
   * }
   * ```
   */
  username?: Input<string>;
  /**
   * The password of the master user.
   * @default A random password is generated.
   * @example
   * ```js
   * {
   *   password: "Passw0rd!"
   * }
   * ```
   *
   * Use [Secrets](/docs/component/secret) to manage the password.
   * ```js
   * {
   *   password: new sst.Secret("MyDBPassword").value
   * }
   * ```
   */
  password?: Input<string>;
  /**
   * Name of a database that is automatically created inside the cluster.
   *
   * The name must begin with a letter and contain only lowercase letters, numbers, or underscores. By default, it takes the name of the app, and replaces the hyphens with underscores.
   *
   * @default Based on the name of the current app
   * @example
   * ```js
   * {
   *   databaseName: "acme"
   * }
   * ```
   */
  database?: Input<string>;
  /**
   * The Aurora Serverless v2 scaling config. By default, the cluster has one DB instance that
   * is used for both writes and reads. The instance can scale from the minimum number of ACUs
   * to the maximum number of ACUs.
   *
   * Each ACU is roughly equivalent to 2 GB of memory. So pick the minimum and maximum
   * based on the baseline and peak memory usage of your app.
   *
   * If you set a minimum of 0 ACU, the database will be paused when there are no active
   * connections within a specified time period. When the database is paused, you are not
   * charged for the ACUs. On the next database connection, the database will resume. It takes
   * about 15 seconds for the database to resume.
   *
   * Auto-pause is useful for minimizing costs in the development environments where the
   * database is not used frequently. It is not recommended for production environments.
   *
   * @default `{min: "0 ACU", max: "4 ACU"}`
   */
  scaling?: Input<{
    /**
     * The minimum number of ACUs, ranges from 0 to 256, in increments of 0.5.
     *
     * For your production workloads, setting a minimum of 0.5 ACUs might not be a great idea due
     * to the following reasons, you can also [read more here](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html#aurora-serverless-v2.setting-capacity.incompatible_parameters).
     * - It takes longer to scale from a low number of ACUs to a much higher number.
     * - Query performance depends on the buffer cache. So if frequently accessed data cannot
     *   fit into the buffer cache, you might see uneven performance.
     * - The max connections for a 0.5 ACU instance is capped at 2000.
     *
     * @default `0.5 ACU`
     * @example
     * ```js
     * {
     *   scaling: {
     *     min: "2 ACU"
     *   }
     * }
     * ```
     */
    min?: Input<ACU>;
    /**
     * The maximum number of ACUs, ranges from 1 to 128, in increments of 0.5.
     *
     * @default `4 ACU`
     * @example
     * ```js
     * {
     *   scaling: {
     *     max: "128 ACU"
     *   }
     * }
     * ```
     */
    max?: Input<ACU>;
    /**
     * The amount of time before the database is paused when there are no active connections.
     *
     * Must be between "5 minutes" and "3600 minutes" ("1 hour")
     *
     * @default `"5 minutes"`
     * @example
     * ```js
     * {
     *   scaling: {
     *     pauseAfter: "20 minutes"
     *   }
     * }
     * ```
     */
    pauseAfter?: Input<DurationHours>;
  }>;
  /**
   * Enable [RDS Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html)
   * for the database.
   * @default `false`
   * @example
   * ```js
   * {
   *   dataApi: true
   * }
   * ```
   */
  dataApi?: Input<boolean>;
  /**
   * Enable [RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html) for the database.
   * @default `false`
   * @example
   * ```js
   * {
   *   proxy: true
   * }
   * ```
   */
  proxy?: Input<
    | boolean
    | {
        /**
         * Additional credentials the proxy can use to connect to the database. You don't
         * need to specify the master user credentials as they are always added by default.
         *
         * :::note
         * This component will not create the database users listed here. You need to
         * create them manually in the database.
         * :::
         *
         * @example
         * ```js
         * {
         *   credentials: [
         *     {
         *       username: "metabase",
         *       password: "Passw0rd!",
         *     }
         *   ]
         * }
         * ```
         *
         * Use [Secrets](/docs/component/secret) to manage the password.
         * ```js
         * {
         *   credentials: [
         *     {
         *       username: "metabase",
         *       password: new sst.Secret("MyDBPassword").value,
         *     }
         *   ]
         * }
         * ```
         */
        credentials?: Input<
          Input<{
            /**
             * The username of the user.
             */
            username: Input<string>;
            /**
             * The password of the user.
             */
            password: Input<string>;
          }>[]
        >;
      }
  >;
  /**
   * The VPC to use for the database cluster.
   *
   * @example
   * Create a VPC component.
   *
   * ```js
   * const myVpc = new sst.aws.Vpc("MyVpc");
   * ```
   *
   * And pass it in.
   *
   * ```js
   * {
   *   vpc: myVpc
   * }
   * ```
   *
   * Or pass in a custom VPC configuration.
   *
   * ```js
   * {
   *   vpc: {
   *     subnets: ["subnet-0db7376a7ad4db5fd ", "subnet-06fc7ee8319b2c0ce"],
   *     securityGroups: ["sg-0399348378a4c256c"]
   *   }
   * }
   * ```
   */
  vpc: Input<{
    /**
     * A list of subnet IDs in the VPC to deploy the Aurora cluster in.
     */
    subnets: Input<Input<string>[]>;
    /**
     * A list of VPC security group IDs.
     */
    securityGroups: Input<Input<string>[]>;
  }>;
  /**
   * Configure how this component works in `sst dev`.
   *
   * By default, your Aurora database is deployed in `sst dev`. But if you want to instead
   * connect to a locally running database, you can configure the `dev` prop.
   *
   * This will skip deploying an Aurora database and link to the locally running database
   * instead.
   *
   * @example
   *
   * Setting the `dev` prop also means that any linked resources will connect to the right
   * database both in `sst dev` and `sst deploy`.
   *
   * ```ts
   * {
   *   dev: {
   *     username: "postgres",
   *     password: "password",
   *     database: "postgres",
   *     host: "localhost",
   *     port: 5432
   *   }
   * }
   * ```
   */
  dev?: {
    /**
     * The host of the local database to connect to when running in dev.
     * @default `"localhost"`
     */
    host?: Input<string>;
    /**
     * The port of the local database to connect to when running in dev.
     * @default `5432`
     */
    port?: Input<number>;
    /**
     * The database of the local database to connect to when running in dev.
     * @default Inherit from the top-level [`database`](#database).
     */
    database?: Input<string>;
    /**
     * The username of the local database to connect to when running in dev.
     * @default Inherit from the top-level [`username`](#username).
     */
    username?: Input<string>;
    /**
     * The password of the local database to connect to when running in dev.
     * @default Inherit from the top-level [`password`](#password).
     */
    password?: Input<string>;
  };
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the RDS subnet group.
     */
    subnetGroup?: Transform<rds.SubnetGroupArgs>;
    /**
     * Transform the RDS cluster parameter group.
     */
    clusterParameterGroup?: Transform<rds.ClusterParameterGroupArgs>;
    /**
     * Transform the RDS instance parameter group.
     */
    instanceParameterGroup?: Transform<rds.ParameterGroupArgs>;
    /**
     * Transform the RDS Cluster.
     */
    cluster?: Transform<rds.ClusterArgs>;
    /**
     * Transform the database instance in the RDS Cluster.
     */
    instance?: Transform<rds.ClusterInstanceArgs>;
    /**
     * Transform the RDS Proxy.
     */
    proxy?: Transform<rds.ProxyArgs>;
  };
}

interface AuroraRef {
  ref: boolean;
  id: Input<string>;
}

/**
 * The `Aurora` component lets you add a Aurora Postgres and Aurora MySQL cluster to your app
 * using [Amazon Aurora Serverless v2](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html).
 *
 * @example
 *
 * #### Create a Aurora Postgres cluster
 *
 * ```js title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const database = new sst.aws.Aurora("MyDatabase", {
 *   engine: "postgres",
 *   vpc,
 * });
 * ```
 *
 * #### Create a Aurora MySQL cluster
 *
 * ```js title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const database = new sst.aws.Aurora("MyDatabase", {
 *   engine: "mysql",
 *   vpc,
 * });
 * ```
 *
 * #### Change the scaling config
 *
 * ```js title="sst.config.ts"
 * new sst.aws.Aurora("MyDatabase", {
 *   engine: "postgres",
 *   scaling: {
 *     min: "2 ACU",
 *     max: "128 ACU"
 *   },
 *   vpc
 * });
 * ```
 *
 * #### Link to a resource
 *
 * You can link your database to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [database],
 *   vpc
 * });
 * ```
 *
 * Once linked, you can connect to it from your function code.
 *
 * ```ts title="app/page.tsx" {1,5-9}
 * import { Resource } from "sst";
 * import postgres from "postgres";
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
 * #### Use the RDS Data API
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Aurora("MyDatabase", {
 *   engine: "postgres",
 *   dataApi: true,
 *   vpc
 * });
 * ```
 *
 * When using the Data API, connecting to the database does not require a persistent
 * connection, and works over HTTP. You also don't need a VPN to connect to it locally.
 *
 * ```ts title="app/page.tsx" {1,6,7,8}
 * import { Resource } from "sst";
 * import { drizzle } from "drizzle-orm/aws-data-api/pg";
 * import { RDSDataClient } from "@aws-sdk/client-rds-data";
 *
 * drizzle(new RDSDataClient({}), {
 *   database: Resource.MyDatabase.database,
 *   secretArn: Resource.MyDatabase.secretArn,
 *   resourceArn: Resource.MyDatabase.clusterArn
 * });
 * ```
 *
 * ---
 *
 * ### Cost
 *
 * By default this component has one DB instance that is used for both writes and reads. The
 * instance can scale from the minimum number of ACUs to the maximum number of ACUs.
 *
 * Each ACU costs $0.12 per hour for both `postgres` and `mysql` engine. The storage costs
 * $0.01 per GB per month for standard storage.
 *
 * When the database is paused, you are not charged for the ACUs.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [Amazon Aurora pricing](https://aws.amazon.com/rds/aurora/pricing) for more details.
 *
 * #### RDS Proxy
 *
 * If you enable the `proxy`, it uses _Provisioned instances_ with 2 vCPUs at $0.015 per hour.
 *
 * That works out to an **additional** $0.015 x 2 x 24 x 30 or **$22 per month**.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [RDS Proxy pricing](https://aws.amazon.com/rds/proxy/pricing/) for more details.
 */
export class Aurora extends Component implements Link.Linkable {
  private cluster: rds.Cluster;
  private instance: rds.ClusterInstance;
  private secret: secretsmanager.Secret;
  private _password: Output<string>;
  private proxy: Output<rds.Proxy | undefined>;
  private dev?: {
    enabled: boolean;
    host: Output<string>;
    port: Output<number>;
    username: Output<string>;
    password: Output<string>;
    database: Output<string>;
  };

  constructor(name: string, args: AuroraArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);
    const self = this;

    if (args && "ref" in args) {
      const ref = reference();
      this.cluster = ref.cluster;
      this.instance = ref.instance;
      this._password = ref.password;
      this.proxy = output(ref.proxy);
      this.secret = ref.secret;
      return;
    }

    const engine = output(args.engine);
    const version = all([args.version, engine]).apply(
      ([version, engine]) =>
        version ?? { postgres: "16.4", mysql: "3.08.0" }[engine],
    );
    const username = all([args.username, engine]).apply(
      ([username, engine]) =>
        username ?? { postgres: "postgres", mysql: "root" }[engine],
    );
    const dbName = output(args.database).apply(
      (name) => name ?? $app.name.replaceAll("-", "_"),
    );
    const dataApi = output(args.dataApi).apply((v) => v ?? false);
    const scaling = normalizeScaling();
    const vpc = normalizeVpc();

    const dev = registerDev();
    if (dev?.enabled) {
      this.dev = dev;
      return;
    }

    const password = createPassword();
    const secret = createSecret();
    const subnetGroup = createSubnetGroup();
    const instanceParameterGroup = createInstanceParameterGroup();
    const clusterParameterGroup = createClusterParameterGroup();
    const proxy = createProxy();
    const cluster = createCluster();
    const instance = createInstance();
    createProxyTarget();

    this.cluster = cluster;
    this.instance = instance;
    this.secret = secret;
    this._password = password;
    this.proxy = proxy;

    function reference() {
      const ref = args as unknown as AuroraRef;
      const cluster = rds.Cluster.get(`${name}Cluster`, ref.id, undefined, {
        parent: self,
      });

      const instance = rds.ClusterInstance.get(
        `${name}Instance`,
        rds
          .getInstancesOutput(
            {
              filters: [
                {
                  name: "db-cluster-id",
                  values: [cluster.id],
                },
              ],
            },
            { parent: self },
          )
          .instanceIdentifiers.apply((ids) => {
            if (!ids.length) {
              throw new VisibleError(
                `Database instance not found in cluster ${cluster.id}`,
              );
            }
            return ids[0];
          }),
        undefined,
        { parent: self },
      );

      const secretId = cluster.tags
        .apply((tags) => tags?.["sst:ref:password"])
        .apply((passwordTag) => {
          if (!passwordTag)
            throw new VisibleError(
              `Failed to get password for Postgres ${name}.`,
            );
          return passwordTag;
        });

      const secret = secretsmanager.Secret.get(
        `${name}ProxySecret`,
        secretId,
        undefined,
        { parent: self },
      );
      const secretVersion = secretsmanager.getSecretVersionOutput(
        { secretId },
        { parent: self },
      );
      const password = $jsonParse(secretVersion.secretString).apply(
        (v) => v.password as string,
      );

      const proxy = cluster.tags
        .apply((tags) => tags?.["sst:ref:proxy"])
        .apply((proxyTag) =>
          proxyTag
            ? rds.Proxy.get(`${name}Proxy`, proxyTag, undefined, {
                parent: self,
              })
            : undefined,
        );

      return { cluster, instance, proxy, password, secret };
    }

    function normalizeScaling() {
      return output(args.scaling).apply((scaling) => {
        const max = scaling?.max ?? "4 ACU";
        const min = scaling?.min ?? "0 ACU";
        const isAutoPauseEnabled = parseACU(min) === 0;
        if (scaling?.pauseAfter && !isAutoPauseEnabled) {
          throw new VisibleError(
            `Cannot configure "pauseAfter" when the minimum ACU is not 0 for the "${name}" Aurora database.`,
          );
        }

        return {
          max,
          min,
          pauseAfter: isAutoPauseEnabled
            ? scaling?.pauseAfter ?? "5 minutes"
            : undefined,
        };
      });
    }

    function normalizeVpc() {
      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return {
          subnets: args.vpc.privateSubnets,
          securityGroups: args.vpc.securityGroups,
        };
      }

      // "vpc" is object
      return output(args.vpc);
    }

    function registerDev() {
      if (!args.dev) return undefined;

      if (
        $dev &&
        args.dev.password === undefined &&
        args.password === undefined
      ) {
        throw new VisibleError(
          `You must provide the password to connect to your locally running database either by setting the "dev.password" or by setting the top-level "password" property.`,
        );
      }

      const dev = {
        enabled: $dev,
        host: output(args.dev.host ?? "localhost"),
        port: output(args.dev.port ?? 5432),
        username: args.dev.username ? output(args.dev.username) : username,
        password: output(args.dev.password ?? args.password ?? ""),
        database: args.dev.database ? output(args.dev.database) : dbName,
      };

      new DevCommand(`${name}Dev`, {
        dev: {
          title: name,
          autostart: true,
          command: `sst print-and-not-quit`,
        },
        environment: {
          SST_DEV_COMMAND_MESSAGE: interpolate`Make sure your local database is using:

  username: "${dev.username}"
  password: "${dev.password}"
  database: "${dev.database}"

Listening on "${dev.host}:${dev.port}"...`,
        },
      });

      return dev;
    }

    function createPassword() {
      return args.password
        ? output(args.password)
        : new RandomPassword(
            `${name}Password`,
            {
              length: 32,
              special: false,
            },
            { parent: self },
          ).result;
    }

    function createSecret() {
      const secret = new secretsmanager.Secret(
        `${name}ProxySecret`,
        {
          recoveryWindowInDays: 0,
        },
        { parent: self },
      );

      new secretsmanager.SecretVersion(
        `${name}ProxySecretVersion`,
        {
          secretId: secret.id,
          secretString: jsonStringify({ username, password }),
        },
        { parent: self },
      );

      return secret;
    }

    function createSubnetGroup() {
      return new rds.SubnetGroup(
        ...transform(
          args.transform?.subnetGroup,
          `${name}SubnetGroup`,
          {
            subnetIds: vpc.subnets,
          },
          { parent: self },
        ),
      );
    }

    function createInstanceParameterGroup() {
      return new rds.ParameterGroup(
        ...transform(
          args.transform?.instanceParameterGroup,
          `${name}ParameterGroup`,
          {
            family: all([engine, version]).apply(([engine, version]) => {
              if (engine === "postgres")
                return `aurora-postgresql${version.split(".")[0]}`;
              return version.startsWith("2")
                ? `aurora-mysql5.7`
                : `aurora-mysql8.0`;
            }),
            parameters: [],
          },
          { parent: self },
        ),
      );
    }

    function createClusterParameterGroup() {
      return new rds.ClusterParameterGroup(
        ...transform(
          args.transform?.clusterParameterGroup,
          `${name}ClusterParameterGroup`,
          {
            family: all([engine, version]).apply(([engine, version]) => {
              if (engine === "postgres")
                return `aurora-postgresql${version.split(".")[0]}`;
              return version.startsWith("2")
                ? `aurora-mysql5.7`
                : `aurora-mysql8.0`;
            }),
            parameters: [],
          },
          { parent: self },
        ),
      );
    }

    function createCluster() {
      return new rds.Cluster(
        ...transform(
          args.transform?.cluster,
          `${name}Cluster`,
          {
            engine: engine.apply((engine) =>
              engine === "postgres"
                ? rds.EngineType.AuroraPostgresql
                : rds.EngineType.AuroraMysql,
            ),
            engineMode: "provisioned",
            engineVersion: all([engine, version]).apply(([engine, version]) => {
              if (engine === "postgres") return version;

              return version.startsWith("2")
                ? `5.7.mysql_aurora.${version}`
                : `8.0.mysql_aurora.${version}`;
            }),
            databaseName: dbName,
            masterUsername: username,
            masterPassword: password,
            dbClusterParameterGroupName: clusterParameterGroup.name,
            dbInstanceParameterGroupName: instanceParameterGroup.name,
            serverlessv2ScalingConfiguration: scaling.apply((scaling) => ({
              maxCapacity: parseACU(scaling.max),
              minCapacity: parseACU(scaling.min),
              secondsUntilAutoPause: scaling.pauseAfter
                ? toSeconds(scaling.pauseAfter)
                : undefined,
            })),
            skipFinalSnapshot: true,
            storageEncrypted: true,
            enableHttpEndpoint: dataApi,
            dbSubnetGroupName: subnetGroup?.name,
            vpcSecurityGroupIds: vpc.securityGroups,
            tags: proxy.apply((proxy) => ({
              "sst:ref:password": secret.id,
              ...(proxy ? { "sst:ref:proxy": proxy.id } : {}),
            })),
          },
          { parent: self },
        ),
      );
    }

    function createInstance() {
      return new rds.ClusterInstance(
        ...transform(
          args.transform?.instance,
          `${name}Instance`,
          {
            clusterIdentifier: cluster.id,
            instanceClass: "db.serverless",
            engine: cluster.engine.apply((v) => v as rds.EngineType),
            engineVersion: cluster.engineVersion,
            dbSubnetGroupName: cluster.dbSubnetGroupName,
            dbParameterGroupName: instanceParameterGroup.name,
          },
          { parent: self },
        ),
      );
    }

    function createProxy() {
      return all([args.proxy]).apply(([proxy]) => {
        if (!proxy) return;

        const credentials = proxy === true ? [] : proxy.credentials ?? [];

        // Create secrets
        const secrets = credentials.map((credential) => {
          const secret = new secretsmanager.Secret(
            `${name}ProxySecret${credential.username}`,
            {
              recoveryWindowInDays: 0,
            },
            { parent: self },
          );

          new secretsmanager.SecretVersion(
            `${name}ProxySecretVersion${credential.username}`,
            {
              secretId: secret.id,
              secretString: jsonStringify({
                username: credential.username,
                password: credential.password,
              }),
            },
            { parent: self },
          );
          return secret;
        });

        const role = new iam.Role(
          `${name}ProxyRole`,
          {
            assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
              Service: "rds.amazonaws.com",
            }),
            inlinePolicies: [
              {
                name: "inline",
                policy: iam.getPolicyDocumentOutput({
                  statements: [
                    {
                      actions: ["secretsmanager:GetSecretValue"],
                      resources: [secret.arn, ...secrets.map((s) => s.arn)],
                    },
                  ],
                }).json,
              },
            ],
          },
          { parent: self },
        );

        const lookup = new RdsRoleLookup(
          `${name}ProxyRoleLookup`,
          { name: "AWSServiceRoleForRDS" },
          { parent: self },
        );

        return new rds.Proxy(
          ...transform(
            args.transform?.proxy,
            `${name}Proxy`,
            {
              engineFamily: engine.apply((engine) =>
                engine === "postgres" ? "POSTGRESQL" : "MYSQL",
              ),
              auths: [
                {
                  authScheme: "SECRETS",
                  iamAuth: "DISABLED",
                  secretArn: secret.arn,
                },
                ...secrets.map((s) => ({
                  authScheme: "SECRETS",
                  iamAuth: "DISABLED",
                  secretArn: s.arn,
                })),
              ],
              roleArn: role.arn,
              vpcSubnetIds: vpc.subnets,
            },
            { parent: self, dependsOn: [lookup] },
          ),
        );
      });
    }

    function createProxyTarget() {
      proxy.apply((proxy) => {
        if (!proxy) return;

        const targetGroup = new rds.ProxyDefaultTargetGroup(
          `${name}ProxyTargetGroup`,
          {
            dbProxyName: proxy.name,
          },
          { parent: self },
        );

        new rds.ProxyTarget(
          `${name}ProxyTarget`,
          {
            dbProxyName: proxy.name,
            targetGroupName: targetGroup.name,
            dbClusterIdentifier: cluster.clusterIdentifier,
          },
          { parent: self },
        );
      });
    }
  }

  /**
   * The ID of the RDS Cluster.
   */
  public get id() {
    return this.dev?.enabled ? output("placeholder") : this.cluster.id;
  }

  /**
   * The ARN of the RDS Cluster.
   */
  public get clusterArn() {
    return this.cluster.arn;
  }

  /**
   * The ARN of the master user secret.
   */
  public get secretArn() {
    return this.secret.arn;
  }

  /** The username of the master user. */
  public get username() {
    if (this.dev?.enabled) return this.dev.username;
    return this.cluster.masterUsername;
  }

  /** The password of the master user. */
  public get password() {
    if (this.dev?.enabled) return this.dev.password;
    return this._password;
  }

  /**
   * The name of the database.
   */
  public get database() {
    if (this.dev?.enabled) return this.dev.database;
    return this.cluster.databaseName;
  }

  /**
   * The port of the database.
   */
  public get port() {
    if (this.dev?.enabled) return this.dev.port;
    return this.instance.port;
  }

  /**
   * The host of the database.
   */
  public get host() {
    if (this.dev?.enabled) return this.dev.host;
    return all([this.cluster.endpoint, this.proxy]).apply(
      ([endpoint, proxy]) => proxy?.endpoint ?? output(endpoint.split(":")[0]),
    );
  }

  public get nodes() {
    return {
      cluster: this.cluster,
      instance: this.instance,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        clusterArn: this.clusterArn,
        secretArn: this.secretArn,
        database: this.database,
        username: this.username,
        password: this.password,
        port: this.port,
        host: this.host,
      },
      include: [
        permission({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [this.secretArn],
        }),
        permission({
          actions: [
            "rds-data:BatchExecuteStatement",
            "rds-data:BeginTransaction",
            "rds-data:CommitTransaction",
            "rds-data:ExecuteStatement",
            "rds-data:RollbackTransaction",
          ],
          resources: [this.clusterArn],
        }),
      ],
    };
  }

  /**
   * Reference an existing Aurora cluster with the given cluster name. This is useful when you
   * create a Aurora cluster in one stage and want to share it in another. It avoids having to
   * create a new Aurora cluster in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Aurora clusters across stages.
   * :::
   *
   * @param name The name of the component.
   * @param id The id of the existing Aurora cluster.
   *
   * @example
   * Imagine you create a cluster in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new cluster, you want to share the same cluster from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const database = $app.stage === "frank"
   *   ? sst.aws.Aurora.get("MyDatabase", "app-dev-mydatabase")
   *   : new sst.aws.Aurora("MyDatabase");
   * ```
   *
   * Here `app-dev-mydatabase` is the ID of the cluster created in the `dev` stage.
   * You can find this by outputting the cluster ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return database.id;
   * ```
   */
  public static get(
    name: string,
    id: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new Aurora(
      name,
      {
        ref: true,
        id,
      } as unknown as AuroraArgs,
      opts,
    );
  }
}

const __pulumiType = "sst:aws:Aurora";
// @ts-expect-error
Aurora.__pulumiType = __pulumiType;
