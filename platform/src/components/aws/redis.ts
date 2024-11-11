import {
  ComponentResourceOptions,
  interpolate,
  jsonStringify,
  Output,
  output,
} from "@pulumi/pulumi";
import { RandomPassword } from "@pulumi/random";
import { Component, Transform, transform } from "../component.js";
import { Link } from "../link.js";
import { Input } from "../input.js";
import { elasticache, secretsmanager } from "@pulumi/aws";
import { Vpc } from "./vpc.js";
import { physicalName } from "../naming.js";
import { VisibleError } from "../error.js";

export interface RedisArgs {
  /**
   * The Redis engine version. Check out the [supported versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/supported-engine-versions.html).
   * @default `"7.1"`
   * @example
   * ```js
   * {
   *   version: "6.2"
   * }
   * ```
   */
  version?: Input<string>;
  /**
   * The type of instance to use for the nodes of the Redis cluster. Check out the [supported instance types](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/CacheNodes.SupportedTypes.html).
   *
   * @default `"t4g.micro"`
   * @example
   * ```js
   * {
   *   instance: "m7g.xlarge"
   * }
   * ```
   */
  instance?: Input<string>;
  /**
   * The number of nodes to use for the Redis cluster.
   *
   * @default `1`
   * @example
   * ```js
   * {
   *   nodes: 4
   * }
   * ```
   */
  nodes?: Input<number>;
  /**
   * The VPC to use for the Redis cluster.
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
  vpc: Input<
    | Vpc
    | {
        /**
         * A list of subnet IDs in the VPC to deploy the Redis cluster in.
         */
        subnets: Input<Input<string>[]>;
        /**
         * A list of VPC security group IDs.
         */
        securityGroups: Input<Input<string>[]>;
      }
  >;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Redis subnet group.
     */
    subnetGroup?: Transform<elasticache.SubnetGroupArgs>;
    /**
     * Transform the Redis cluster.
     */
    cluster?: Transform<elasticache.ReplicationGroupArgs>;
  };
}

interface RedisRef {
  ref: boolean;
  cluster: elasticache.ReplicationGroup;
  authToken: Output<string>;
}

/**
 * The `Redis` component lets you add a Redis cluster to your app using
 * [Amazon ElastiCache](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/WhatIs.html).
 *
 * @example
 *
 * #### Create the cluster
 *
 * ```js title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const redis = new sst.aws.Redis("MyRedis", { vpc });
 * ```
 *
 * #### Link to a resource
 *
 * You can link your cluster to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [redis],
 *   vpc
 * });
 * ```
 *
 * Once linked, you can connect to it from your function code.
 *
 * ```ts title="app/page.tsx" {1,6,7,12,13}
 * import { Resource } from "sst";
 * import { Cluster } from "ioredis";
 *
 * const client = new Cluster(
 *   [{
 *     host: Resource.MyRedis.host,
 *     port: Resource.MyRedis.port
 *   }],
 *   {
 *     redisOptions: {
 *       tls: { checkServerIdentity: () => undefined },
 *       username: Resource.MyRedis.username,
 *       password: Resource.MyRedis.password
 *     }
 *   }
 * );
 * ```
 *
 * ---
 *
 * ### Cost
 *
 * By default this component uses _On-demand nodes_ with a single `cache.t4g.micro` instance;
 * $0.016 per hour.
 *
 * That works out to $0.016 x 24 x 30 or **$12 per month**.
 *
 * Adjust this for the `instance` type and number of `nodes` you are using.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/) for more details.
 */
export class Redis extends Component implements Link.Linkable {
  private cluster: elasticache.ReplicationGroup;
  private _authToken: Output<string>;

  constructor(name: string, args: RedisArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    if (args && "ref" in args) {
      const ref = args as unknown as RedisRef;
      this.cluster = ref.cluster;
      this._authToken = ref.authToken;
      return;
    }

    const parent = this;
    const version = output(args.version).apply((v) => v ?? "7.1");
    const instance = output(args.instance).apply((v) => v ?? "t4g.micro");
    const nodes = output(args.nodes).apply((v) => v ?? 1);
    const vpc = normalizeVpc();

    const { authToken, secret } = createAuthToken();
    const subnetGroup = createSubnetGroup();
    const cluster = createCluster();

    this.cluster = cluster;
    this._authToken = authToken;

    function normalizeVpc() {
      return output(args.vpc).apply((vpc) => {
        // "vpc" is a Vpc component
        if (vpc instanceof Vpc) {
          return output({
            subnets: vpc.privateSubnets,
            securityGroups: vpc.securityGroups,
          });
        }

        // "vpc" is object
        return output(vpc);
      });
    }

    function createAuthToken() {
      const authToken = new RandomPassword(
        `${name}AuthToken`,
        {
          length: 32,
          special: true,
          overrideSpecial: "!&#$^<>-",
        },
        { parent },
      ).result;

      const secret = new secretsmanager.Secret(
        `${name}ProxySecret`,
        {
          recoveryWindowInDays: 0,
        },
        { parent },
      );

      new secretsmanager.SecretVersion(
        `${name}ProxySecretVersion`,
        {
          secretId: secret.id,
          secretString: jsonStringify({ authToken }),
        },
        { parent },
      );

      return { secret, authToken };
    }

    function createSubnetGroup() {
      return new elasticache.SubnetGroup(
        ...transform(
          args.transform?.subnetGroup,
          `${name}SubnetGroup`,
          {
            description: "Managed by SST",
            subnetIds: vpc.subnets,
          },
          { parent },
        ),
      );
    }

    function createCluster() {
      return new elasticache.ReplicationGroup(
        ...transform(
          args.transform?.cluster,
          `${name}Cluster`,
          {
            replicationGroupId: physicalName(40, name),
            description: "Managed by SST",
            engine: "redis",
            engineVersion: version,
            nodeType: interpolate`cache.${instance}`,
            dataTieringEnabled: instance.apply((v) => v.startsWith("r6gd.")),
            port: 6379,
            automaticFailoverEnabled: true,
            clusterMode: "enabled",
            numNodeGroups: nodes,
            replicasPerNodeGroup: 0,
            multiAzEnabled: false,
            atRestEncryptionEnabled: true,
            transitEncryptionEnabled: true,
            transitEncryptionMode: "required",
            authToken,
            subnetGroupName: subnetGroup.name,
            securityGroupIds: vpc.securityGroups,
            tags: {
              "sst:auth-token-ref": secret.id,
            },
          },
          { parent },
        ),
      );
    }
  }

  /**
   * The ID of the Redis cluster.
   */
  public get clusterID() {
    return this.cluster.id;
  }

  /**
   * The username to connect to the Redis cluster.
   */
  public get username() {
    return output("default");
  }

  /**
   * The password to connect to the Redis cluster.
   */
  public get password() {
    return this._authToken;
  }

  /**
   * The host to connect to the Redis cluster.
   */
  public get host() {
    return this.cluster.configurationEndpointAddress;
  }

  /**
   * The port to connect to the Redis cluster.
   */
  public get port() {
    return this.cluster.port.apply((v) => v!);
  }

  public get nodes() {
    return {
      cluster: this.cluster,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        host: this.host,
        port: this.port,
        username: this.username,
        password: this.password,
      },
    };
  }

  /**
   * Reference an existing Redis cluster with the given cluster name. This is useful when you
   * create a Redis cluster in one stage and want to share it in another. It avoids having to
   * create a new Redis cluster in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Redis clusters across stages.
   * :::
   *
   * @param name The name of the component.
   * @param clusterID The id of the existing Redis cluster.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a cluster in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new cluster, you want to share the same cluster from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const redis = $app.stage === "frank"
   *   ? sst.aws.Redis.get("MyRedis", "app-dev-myredis")
   *   : new sst.aws.Redis("MyRedis");
   * ```
   *
   * Here `app-dev-myredis` is the ID of the cluster created in the `dev` stage.
   * You can find this by outputting the cluster ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   cluster: redis.clusterID
   * };
   * ```
   */
  public static get(
    name: string,
    clusterID: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    const cluster = elasticache.ReplicationGroup.get(
      `${name}Cluster`,
      clusterID,
      undefined,
      opts,
    );
    const secret = cluster.tags.apply((tags) =>
      tags?.["sst:auth-token-ref"]
        ? secretsmanager.getSecretVersionOutput(
            {
              secretId: tags["sst:auth-token-ref"],
            },
            opts,
          )
        : output(undefined),
    );
    const authToken = secret.apply((v) => {
      if (!v)
        throw new VisibleError(`Failed to get auth token for Redis ${name}.`);
      return JSON.parse(v.secretString).authToken as string;
    });

    return new Redis(name, {
      ref: true,
      cluster,
      authToken,
    } as unknown as RedisArgs);
  }
}

const __pulumiType = "sst:aws:Redis";
// @ts-expect-error
Redis.__pulumiType = __pulumiType;
