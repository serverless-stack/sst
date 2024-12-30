import fs from "fs";
import path from "path";
import {
  all,
  ComponentResourceOptions,
  interpolate,
  Output,
  output,
  secret,
} from "@pulumi/pulumi";
import { Component, Prettify, Transform, transform } from "../component";
import { Input } from "../input";
import { Dns } from "../dns";
import { FunctionArgs } from "./function";
import { Service, ServiceArgs } from "./service";
import { RETENTION } from "./logging.js";
import {
  appautoscaling,
  cloudwatch,
  ec2,
  ecs,
  iam,
  lb,
  getPartitionOutput,
  getRegionOutput,
  ecr,
} from "@pulumi/aws";
import { ImageArgs, Platform } from "@pulumi/docker-build";
import { Cluster as ClusterV1 } from "./cluster-v1";
import { Vpc } from "./vpc";
import { Vpc as VpcV1 } from "./vpc-v1.js";
import { Efs } from "./efs";
import { DurationMinutes, toSeconds } from "../duration";
import { Task } from "./task";
import { VisibleError } from "../error";
import { toGBs, toMBs } from "../size";
import { Link } from "../link";
import { Permission } from "./permission";
import { imageBuilder } from "./helpers/container-builder";
import { bootstrap } from "./helpers/bootstrap";
import { toNumber } from "../cpu";
export type { ClusterArgs as ClusterV1Args } from "./cluster-v1";

export const supportedCpus = {
  "0.25 vCPU": 256,
  "0.5 vCPU": 512,
  "1 vCPU": 1024,
  "2 vCPU": 2048,
  "4 vCPU": 4096,
  "8 vCPU": 8192,
  "16 vCPU": 16384,
};

export const supportedMemories = {
  "0.25 vCPU": {
    "0.5 GB": 512,
    "1 GB": 1024,
    "2 GB": 2048,
  },
  "0.5 vCPU": {
    "1 GB": 1024,
    "2 GB": 2048,
    "3 GB": 3072,
    "4 GB": 4096,
  },
  "1 vCPU": {
    "2 GB": 2048,
    "3 GB": 3072,
    "4 GB": 4096,
    "5 GB": 5120,
    "6 GB": 6144,
    "7 GB": 7168,
    "8 GB": 8192,
  },
  "2 vCPU": {
    "4 GB": 4096,
    "5 GB": 5120,
    "6 GB": 6144,
    "7 GB": 7168,
    "8 GB": 8192,
    "9 GB": 9216,
    "10 GB": 10240,
    "11 GB": 11264,
    "12 GB": 12288,
    "13 GB": 13312,
    "14 GB": 14336,
    "15 GB": 15360,
    "16 GB": 16384,
  },
  "4 vCPU": {
    "8 GB": 8192,
    "9 GB": 9216,
    "10 GB": 10240,
    "11 GB": 11264,
    "12 GB": 12288,
    "13 GB": 13312,
    "14 GB": 14336,
    "15 GB": 15360,
    "16 GB": 16384,
    "17 GB": 17408,
    "18 GB": 18432,
    "19 GB": 19456,
    "20 GB": 20480,
    "21 GB": 21504,
    "22 GB": 22528,
    "23 GB": 23552,
    "24 GB": 24576,
    "25 GB": 25600,
    "26 GB": 26624,
    "27 GB": 27648,
    "28 GB": 28672,
    "29 GB": 29696,
    "30 GB": 30720,
  },
  "8 vCPU": {
    "16 GB": 16384,
    "20 GB": 20480,
    "24 GB": 24576,
    "28 GB": 28672,
    "32 GB": 32768,
    "36 GB": 36864,
    "40 GB": 40960,
    "44 GB": 45056,
    "48 GB": 49152,
    "52 GB": 53248,
    "56 GB": 57344,
    "60 GB": 61440,
  },
  "16 vCPU": {
    "32 GB": 32768,
    "40 GB": 40960,
    "48 GB": 49152,
    "56 GB": 57344,
    "64 GB": 65536,
    "72 GB": 73728,
    "80 GB": 81920,
    "88 GB": 90112,
    "96 GB": 98304,
    "104 GB": 106496,
    "112 GB": 114688,
    "120 GB": 122880,
  },
};

type Port = `${number}/${"http" | "https" | "tcp" | "udp" | "tcp_udp" | "tls"}`;

type ClusterVpcArgs = {
  /**
   * The ID of the VPC.
   */
  id: Input<string>;
  /**
   * A list of VPC security group IDs for the service.
   */
  securityGroups: Input<Input<string>[]>;
  /**
   * A list of subnet IDs in the VPC to place the services in.
   * @deprecated Use `containerSubnets` instead.
   */
  serviceSubnets?: Input<Input<string>[]>;
  /**
   * A list of subnet IDs in the VPC to place the containers in.
   */
  containerSubnets?: Input<Input<string>[]>;
  /**
   * A list of subnet IDs in the VPC to place the load balancer in.
   */
  loadBalancerSubnets: Input<Input<string>[]>;
  /**
   * The ID of the Cloud Map namespace to use for the service.
   */
  cloudmapNamespaceId: Input<string>;
  /**
   * The name of the Cloud Map namespace to use for the service.
   */
  cloudmapNamespaceName: Input<string>;
};

export type ClusterVpcsNormalizedArgs = Required<
  Pick<ClusterVpcArgs, "containerSubnets">
> &
  Omit<ClusterVpcArgs, "containerSubnets" | "serviceSubnets">;

export interface ClusterArgs {
  /**
   * The VPC to use for the cluster.
   *
   * @example
   * Create a `Vpc` component.
   *
   * ```js title="sst.config.ts"
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
   * By default, both the load balancer and the services are deployed in public subnets.
   * The above is equivalent to:
   *
   * ```js
   * {
   *   vpc: {
   *     id: myVpc.id,
   *     securityGroups: myVpc.securityGroups,
   *     containerSubnets: myVpc.publicSubnets,
   *     loadBalancerSubnets: myVpc.publicSubnets,
   *     cloudmapNamespaceId: myVpc.nodes.cloudmapNamespace.id,
   *     cloudmapNamespaceName: myVpc.nodes.cloudmapNamespace.name,
   *   }
   * }
   * ```
   */
  vpc: Vpc | Input<Prettify<ClusterVpcArgs>>;
  /** @internal */
  forceUpgrade?: "v2";
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the ECS Cluster resource.
     */
    cluster?: Transform<ecs.ClusterArgs>;
  };
}

interface TaskContainerArgs {
  /**
   * The name of the container.
   *
   * This is used as the `--name` option in the Docker run command.
   */
  name: Input<string>;
  /**
   * The amount of CPU allocated to the container.
   *
   * By default, a container can use up to all the CPU allocated to all the containers. If set,
   * this container is capped at this allocation even if more idle CPU is available.
   *
   * The sum of all the containers' CPU must be less than or equal to the total available CPU.
   *
   * @example
   * ```js
   * {
   *   cpu: "0.25 vCPU"
   * }
   * ```
   */
  cpu?: `${number} vCPU`;
  /**
   * The amount of memory allocated to the container.
   *
   * By default, a container can use up to all the memory allocated to all the containers. If
   * set, the container is capped at this allocation. If exceeded, the container will be killed
   * even if there is idle memory available.
   *
   * The sum of all the containers' memory must be less than or equal to the total available
   * memory.
   *
   * @example
   * ```js
   * {
   *   memory: "0.5 GB"
   * }
   * ```
   */
  memory?: `${number} GB`;
  /**
   * Configure the Docker image for the container. Same as the top-level [`image`](#image).
   */
  image?: Input<
    | string
    | {
        /**
         * The path to the Docker build context. Same as the top-level
         * [`image.context`](#image-context).
         */
        context?: Input<string>;
        /**
         * The path to the Dockerfile. Same as the top-level
         * [`image.dockerfile`](#image-dockerfile).
         */
        dockerfile?: Input<string>;
        /**
         * Key-value pairs of build args. Same as the top-level [`image.args`](#image-args).
         */
        args?: Input<Record<string, Input<string>>>;
        /**
         * The stage to build up to. Same as the top-level [`image.target`](#image-target).
         */
        target?: Input<string>;
      }
  >;
  /**
   * The command to override the default command in the container. Same as the top-level
   * [`command`](#command).
   */
  command?: Input<string[]>;
  /**
   * The entrypoint to override the default entrypoint in the container. Same as the top-level
   * [`entrypoint`](#entrypoint).
   */
  entrypoint?: Input<string[]>;
  /**
   * Key-value pairs of values that are set as container environment variables. Same as the
   * top-level [`environment`](#environment).
   */
  environment?: FunctionArgs["environment"];
  /**
   * Configure the logs in CloudWatch. Same as the top-level [`logging`](#logging).
   */
  logging?: Input<{
    /**
     * The duration the logs are kept in CloudWatch. Same as the top-level
     * [`logging.retention`](#logging-retention).
     */
    retention?: Input<keyof typeof RETENTION>;
  }>;
  /**
   * Key-value pairs of AWS Systems Manager Parameter Store parameter ARNs or AWS Secrets
   * Manager secret ARNs. The values will be loaded into the container as environment
   * variables. Same as the top-level [`ssm`](#ssm).
   */
  ssm?: ClusterServiceArgs["ssm"];
  /**
   * Mount Amazon EFS file systems into the container. Same as the top-level
   * [`efs`](#efs).
   */
  volumes?: ClusterServiceArgs["volumes"];
}

interface ServiceContainerArgs extends TaskContainerArgs {
  /**
   * Configure the health check for the container. Same as the top-level
   * [`health`](#health).
   */
  health?: ClusterServiceArgs["health"];
  /**
   * Configure how this container works in `sst dev`. Same as the top-level
   * [`dev`](#dev).
   */
  dev?: {
    /**
     * The command that `sst dev` runs to start this in dev mode. Same as the top-level
     * [`dev.command`](#dev-command).
     */
    command: Input<string>;
    /**
     * Configure if you want to automatically start this when `sst dev` starts. Same as the
     * top-level [`dev.autostart`](#dev-autostart).
     */
    autostart?: Input<boolean>;
    /**
     * Change the directory from where the `command` is run. Same as the top-level
     * [`dev.directory`](#dev-directory).
     */
    directory?: Input<string>;
  };
}

interface ClusterBaseArgs {
  /**
   * The CPU architecture of the container.
   * @default `"x86_64"`
   * @example
   * ```js
   * {
   *   architecture: "arm64"
   * }
   * ```
   */
  architecture?: Input<"x86_64" | "arm64">;
  /**
   * The amount of CPU allocated to the container. If there are multiple containers, this is
   * the total amount of CPU shared across all the containers.
   *
   * :::note
   * [View the valid combinations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html#fargate-tasks-size) of CPU and memory.
   * :::
   *
   * @default `"0.25 vCPU"`
   * @example
   * ```js
   * {
   *   cpu: "1 vCPU"
   * }
   * ```
   */
  cpu?: keyof typeof supportedCpus;
  /**
   * The amount of memory allocated to the container. If there are multiple containers, this is
   * the total amount of memory shared across all the containers.
   *
   * :::note
   * [View the valid combinations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html#fargate-tasks-size) of CPU and memory.
   * :::
   *
   * @default `"0.5 GB"`
   *
   * @example
   * ```js
   * {
   *   memory: "2 GB"
   * }
   * ```
   */
  memory?: `${number} GB`;
  /**
   * The amount of ephemeral storage (in GB) allocated to the container.
   *
   * @default `"20 GB"`
   *
   * @example
   * ```js
   * {
   *   storage: "100 GB"
   * }
   * ```
   */
  storage?: `${number} GB`;
  /**
   * [Link resources](/docs/linking/) to your containers. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your app using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of components to link to the containers.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: FunctionArgs["link"];
  /**
   * Permissions and the resources that you need to access. These permissions are
   * used to create the [task role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).
   *
   * :::tip
   * If you `link` the service to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow the container to read and write to an S3 bucket called `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:GetObject", "s3:PutObject"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Allow the container to perform all actions on an S3 bucket called `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:*"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Granting the container permissions to access all resources.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["*"],
   *       resources: ["*"]
   *     },
   *   ]
   * }
   * ```
   */
  permissions?: FunctionArgs["permissions"];
  /**
   * Configure the Docker build command for building the image or specify a pre-built image.
   *
   * @default Build a Docker image from the Dockerfile in the root directory.
   * @example
   *
   * Building a Docker image.
   *
   * Prior to building the image, SST will automatically add the `.sst` directory
   * to the `.dockerignore` if not already present.
   *
   * ```js
   * {
   *   image: {
   *     context: "./app",
   *     dockerfile: "Dockerfile",
   *     args: {
   *       MY_VAR: "value"
   *     }
   *   }
   * }
   * ```
   *
   * Alternatively, you can pass in a pre-built image.
   *
   * ```js
   * {
   *   image: "nginxdemos/hello:plain-text"
   * }
   * ```
   */
  image?: Input<
    | string
    | {
        /**
         * The path to the [Docker build context](https://docs.docker.com/build/building/context/#local-context). The path is relative to your project's `sst.config.ts`.
         * @default `"."`
         * @example
         *
         * To change where the Docker build context is located.
         *
         * ```js
         * {
         *   context: "./app"
         * }
         * ```
         */
        context?: Input<string>;
        /**
         * The path to the [Dockerfile](https://docs.docker.com/reference/cli/docker/image/build/#file).
         * The path is relative to the build `context`.
         * @default `"Dockerfile"`
         * @example
         * To use a different Dockerfile.
         * ```js
         * {
         *   dockerfile: "Dockerfile.prod"
         * }
         * ```
         */
        dockerfile?: Input<string>;
        /**
         * Key-value pairs of [build args](https://docs.docker.com/build/guide/build-args/) to pass to the Docker build command.
         * @example
         * ```js
         * {
         *   args: {
         *     MY_VAR: "value"
         *   }
         * }
         * ```
         */
        args?: Input<Record<string, Input<string>>>;
        /**
         * Tags to apply to the Docker image.
         * @example
         * ```js
         * {
         *   tags: ["v1.0.0", "commit-613c1b2"]
         * }
         * ```
         */
        tags?: Input<Input<string>[]>;
        /**
         * The stage to build up to in a [multi-stage Dockerfile](https://docs.docker.com/build/building/multi-stage/#stop-at-a-specific-build-stage).
         * @example
         * ```js
         * {
         *   target: "stage1"
         * }
         * ```
         */
        target?: Input<string>;
      }
  >;
  /**
   * The command to override the default command in the container.
   * @example
   * ```js
   * {
   *   command: ["npm", "run", "start"]
   * }
   * ```
   */
  command?: Input<Input<string>[]>;
  /**
   * The entrypoint that overrides the default entrypoint in the container.
   * @example
   * ```js
   * {
   *   entrypoint: ["/usr/bin/my-entrypoint"]
   * }
   * ```
   */
  entrypoint?: Input<string[]>;
  /**
   * Key-value pairs of values that are set as [container environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/taskdef-envfiles.html).
   * The keys need to:
   *
   * 1. Start with a letter.
   * 2. Be at least 2 characters long.
   * 3. Contain only letters, numbers, or underscores.
   *
   * @example
   *
   * ```js
   * {
   *   environment: {
   *     DEBUG: "true"
   *   }
   * }
   * ```
   */
  environment?: FunctionArgs["environment"];
  /**
   * Key-value pairs of AWS Systems Manager Parameter Store parameter ARNs or AWS Secrets
   * Manager secret ARNs. The values will be loaded into the container as environment
   * variables.
   * @example
   * ```js
   * {
   *   ssm: {
   *     DATABASE_PASSWORD: "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-123abc"
   *   }
   * }
   * ```
   */
  ssm?: Input<Record<string, Input<string>>>;
  /**
   * Configure the logs in CloudWatch.
   * @default `{ retention: "1 month" }`
   * @example
   * ```js
   * {
   *   logging: {
   *     retention: "forever"
   *   }
   * }
   * ```
   */
  logging?: Input<{
    /**
     * The duration the logs are kept in CloudWatch.
     * @default `"1 month"`
     */
    retention?: Input<keyof typeof RETENTION>;
  }>;
  /**
   * Mount Amazon EFS file systems into the container.
   *
   * @example
   * Create an EFS file system.
   *
   * ```ts title="sst.config.ts"
   * const vpc = new sst.aws.Vpc("MyVpc");
   * const fileSystem = new sst.aws.Efs("MyFileSystem", { vpc });
   * ```
   *
   * And pass it in.
   *
   * ```js
   * {
   *   volumes: [
   *     {
   *       efs: fileSystem,
   *       path: "/mnt/efs"
   *     }
   *   ]
   * }
   * ```
   *
   * Or pass in a the EFS file system ID.
   *
   * ```js
   * {
   *   volumes: [
   *     {
   *       efs: {
   *         fileSystem: "fs-12345678",
   *         accessPoint: "fsap-12345678"
   *       },
   *       path: "/mnt/efs"
   *     }
   *   ]
   * }
   * ```
   */
  volumes?: Input<{
    /**
     * The Amazon EFS file system to mount.
     */
    efs: Input<
      | Efs
      | {
          /**
           * The ID of the EFS file system.
           */
          fileSystem: Input<string>;
          /**
           * The ID of the EFS access point.
           */
          accessPoint: Input<string>;
        }
    >;
    /**
     * The path to mount the volume.
     */
    path: Input<string>;
  }>[];
  /**
   * Assigns the given IAM role name to the containers. This allows you to pass in a previously
   * created role.
   *
   * :::caution
   * When you pass in a role, it will not update it if you add `permissions` or `link` resources.
   * :::
   *
   * By default, a new IAM role is created. It'll update this role if you add `permissions` or
   * `link` resources.
   *
   * However, if you pass in a role, you'll need to update it manually if you add `permissions`
   * or `link` resources.
   *
   * @default Creates a new role
   * @example
   * ```js
   * {
   *   taskRole: "my-task-role"
   * }
   * ```
   */
  taskRole?: Input<string>;
  /**
   * Assigns the given IAM role name to AWS ECS to launch and manage the containers. This
   * allows you to pass in a previously created role.
   *
   * By default, a new IAM role is created.
   *
   * @default Creates a new role
   * @example
   * ```js
   * {
   *   executionRole: "my-execution-role"
   * }
   * ```
   */
  executionRole?: Input<string>;
}

export interface ClusterServiceArgs extends ClusterBaseArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your service is not deployed.
   * :::
   *
   * By default, your service in not deployed in `sst dev`. Instead, you can set the
   * `dev.command` and it'll be started locally in a separate tab in the
   * `sst dev` multiplexer. Read more about [`sst dev`](/docs/reference/cli/#dev).
   *
   * This makes it so that the container doesn't have to be redeployed on every change. To
   * disable this and deploy your service in `sst dev`, pass in `false`.
   */
  dev?:
    | false
    | {
        /**
         * The `url` when this is running in dev mode.
         *
         * Since this component is not deployed in `sst dev`, there is no real URL. But if you are
         * using this component's `url` or linking to this component's `url`, it can be useful to
         * have a placeholder URL. It avoids having to handle it being `undefined`.
         * @default `"http://url-unavailable-in-dev.mode"`
         */
        url?: Input<string>;
        /**
         * The command that `sst dev` runs to start this in dev mode. This is the command you run
         * when you want to run your service locally.
         */
        command?: Input<string>;
        /**
         * Configure if you want to automatically start this when `sst dev` starts. You can still
         * start it manually later.
         * @default `true`
         */
        autostart?: Input<boolean>;
        /**
         * Change the directory from where the `command` is run.
         * @default Uses the `image.dockerfile` path
         */
        directory?: Input<string>;
      };
  /**
   * Configure a public endpoint for the service. When configured, a load balancer
   * will be created to route traffic to the containers. By default, the endpoint is an
   * autogenerated load balancer URL.
   *
   * You can also add a custom domain for the public endpoint.
   * @deprecated Use `loadBalancer` instead.
   * @example
   *
   * ```js
   * {
   *   public: {
   *     domain: "example.com",
   *     ports: [
   *       { listen: "80/http" },
   *       { listen: "443/https", forward: "80/http" }
   *     ]
   *   }
   * }
   * ```
   */
  public?: Input<{
    /**
     * Set a custom domain for your public endpoint.
     *
     * Automatically manages domains hosted on AWS Route 53, Cloudflare, and Vercel. For other
     * providers, you'll need to pass in a `cert` that validates domain ownership and add the
     * DNS records.
     *
     * :::tip
     * Built-in support for AWS Route 53, Cloudflare, and Vercel. And manual setup for other
     * providers.
     * :::
     *
     * @example
     *
     * By default this assumes the domain is hosted on Route 53.
     *
     * ```js
     * {
     *   domain: "example.com"
     * }
     * ```
     *
     * For domains hosted on Cloudflare.
     *
     * ```js
     * {
     *   domain: {
     *     name: "example.com",
     *     dns: sst.cloudflare.dns()
     *   }
     * }
     * ```
     */
    domain?: Input<
      | string
      | {
          /**
           * The custom domain you want to use.
           *
           * @example
           * ```js
           * {
           *   domain: {
           *     name: "example.com"
           *   }
           * }
           * ```
           *
           * Can also include subdomains based on the current stage.
           *
           * ```js
           * {
           *   domain: {
           *     name: `${$app.stage}.example.com`
           *   }
           * }
           * ```
           */
          name: Input<string>;
          /**
           * Alias domains that should be used.
           *
           * @example
           * ```js {4}
           * {
           *   domain: {
           *     name: "app1.example.com",
           *     aliases: ["app2.example.com"]
           *   }
           * }
           * ```
           */
          aliases?: Input<string[]>;
          /**
           * The ARN of an ACM (AWS Certificate Manager) certificate that proves ownership of the
           * domain. By default, a certificate is created and validated automatically.
           *
           * :::tip
           * You need to pass in a `cert` for domains that are not hosted on supported `dns` providers.
           * :::
           *
           * To manually set up a domain on an unsupported provider, you'll need to:
           *
           * 1. [Validate that you own the domain](https://docs.aws.amazon.com/acm/latest/userguide/domain-ownership-validation.html) by creating an ACM certificate. You can either validate it by setting a DNS record or by verifying an email sent to the domain owner.
           * 2. Once validated, set the certificate ARN as the `cert` and set `dns` to `false`.
           * 3. Add the DNS records in your provider to point to the load balancer endpoint.
           *
           * @example
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: false,
           *     cert: "arn:aws:acm:us-east-1:112233445566:certificate/3a958790-8878-4cdc-a396-06d95064cf63"
           *   }
           * }
           * ```
           */
          cert?: Input<string>;
          /**
           * The DNS provider to use for the domain. Defaults to the AWS.
           *
           * Takes an adapter that can create the DNS records on the provider. This can automate
           * validating the domain and setting up the DNS routing.
           *
           * Supports Route 53, Cloudflare, and Vercel adapters. For other providers, you'll need
           * to set `dns` to `false` and pass in a certificate validating ownership via `cert`.
           *
           * @default `sst.aws.dns`
           *
           * @example
           *
           * Specify the hosted zone ID for the Route 53 domain.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.aws.dns({
           *       zone: "Z2FDTNDATAQYW2"
           *     })
           *   }
           * }
           * ```
           *
           * Use a domain hosted on Cloudflare, needs the Cloudflare provider.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.cloudflare.dns()
           *   }
           * }
           * ```
           *
           * Use a domain hosted on Vercel, needs the Vercel provider.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.vercel.dns()
           *   }
           * }
           * ```
           */
          dns?: Input<false | (Dns & {})>;
        }
    >;
    /**
     * Configure the mapping for the ports the public endpoint listens to and forwards to
     * the service.
     * This supports two types of protocols:
     *
     * 1. Application Layer Protocols: `http` and `https`. This'll create an [Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html).
     * 2. Network Layer Protocols: `tcp`, `udp`, `tcp_udp`, and `tls`. This'll create a [Network Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html).
     *
     * :::note
     * If you are listening  on `https` or `tls`, you need to specify a custom `public.domain`.
     * :::
     *
     * You can **not** configure both application and network layer protocols for the same
     * service.
     *
     * @example
     * Here we are listening on port `80` and forwarding it to the service on port `8080`.
     * ```js
     * {
     *   public: {
     *     ports: [
     *       { listen: "80/http", forward: "8080/http" }
     *     ]
     *   }
     * }
     * ```
     *
     * The `forward` port and protocol defaults to the `listen` port and protocol. So in this
     * case both are `80/http`.
     *
     * ```js
     * {
     *   public: {
     *     ports: [
     *       { listen: "80/http" }
     *     ]
     *   }
     * }
     * ```
     *
     * If multiple containers are configured via the `containers` argument, you need to
     * specify which container the traffic should be forwarded to.
     *
     * ```js
     * {
     *   public: {
     *     ports: [
     *       { listen: "80/http", container: "app" },
     *       { listen: "8000/http", container: "admin" },
     *     ]
     *   }
     * }
     * ```
     */
    ports: Input<
      {
        /**
         * The port and protocol the service listens on. Uses the format `{port}/{protocol}`.
         */
        listen: Input<Port>;
        /**
         * The port and protocol of the container the service forwards the traffic to. Uses the
         * format `{port}/{protocol}`.
         * @default The same port and protocol as `listen`.
         */
        forward?: Input<Port>;
        /**
         * Configure path-based routing. Only requests matching the path are forwarded to
         * the container. Only applicable to "http" protocols.
         *
         * @default Requests to all paths are forwarded.
         */
        path?: Input<string>;
        /**
         * Configure query string based routing. Only requests matching the query string are
         * forwarded to the container. Only applicable to "http" protocols.
         *
         * The query string pattern supports exact matches and wildcards.
         *
         * For example:
         * - `version=v1`
         * - `env=*`
         * - `env=prod&version=v1`
         *
         * @default Requests with any query string are forwarded.
         */
        queryString?: Input<string>;
        /**
         * The name of the container to forward the traffic to.
         *
         * If there is only one container, this is not needed. The traffic is automatically
         * forwarded to the container.
         *
         * If there is more than one container, this is required.
         *
         * @default The container name when there is only one container.
         */
        container?: Input<string>;
        /**
         * The port and protocol to redirect the traffic to. Uses the format `{port}/{protocol}`.
         */
        redirect?: Input<Port>;
      }[]
    >;
  }>;
  /**
   * Configure a load balancer to route traffic to the containers.
   *
   * While you can expose a service through API Gateway, it's better to use a load balancer
   * for most traditional web applications. It is more expensive to start but at higher
   * levels of traffic it ends up being more cost effective.
   *
   * Also, if you need to listen on network layer protocols like `tcp` or `udp`, you have to
   * expose it through a load balancer.
   *
   * By default, the endpoint is an autogenerated load balancer URL. You can also add a
   * custom domain for the endpoint.
   *
   * @default Load balancer is not created
   * @example
   *
   * ```js
   * {
   *   loadBalancer: {
   *     domain: "example.com",
   *     ports: [
   *       { listen: "80/http", redirect: "443/https" },
   *       { listen: "443/https", forward: "80/http" }
   *     ]
   *   }
   * }
   * ```
   */
  loadBalancer?: Input<{
    /**
     * Configure if the load balancer should be public or private.
     *
     * When set to `false`, the load balancer endpoint will only be accessible within the
     * VPC.
     *
     * @default `true`
     */
    public?: Input<boolean>;
    /**
     * Set a custom domain for your load balancer endpoint.
     *
     * Automatically manages domains hosted on AWS Route 53, Cloudflare, and Vercel. For other
     * providers, you'll need to pass in a `cert` that validates domain ownership and add the
     * DNS records.
     *
     * :::tip
     * Built-in support for AWS Route 53, Cloudflare, and Vercel. And manual setup for other
     * providers.
     * :::
     *
     * @example
     *
     * By default this assumes the domain is hosted on Route 53.
     *
     * ```js
     * {
     *   domain: "example.com"
     * }
     * ```
     *
     * For domains hosted on Cloudflare.
     *
     * ```js
     * {
     *   domain: {
     *     name: "example.com",
     *     dns: sst.cloudflare.dns()
     *   }
     * }
     * ```
     */
    domain?: Input<
      | string
      | {
          /**
           * The custom domain you want to use.
           *
           * @example
           * ```js
           * {
           *   domain: {
           *     name: "example.com"
           *   }
           * }
           * ```
           *
           * Can also include subdomains based on the current stage.
           *
           * ```js
           * {
           *   domain: {
           *     name: `${$app.stage}.example.com`
           *   }
           * }
           * ```
           *
           * Wildcard domains are supported.
           *
           * ```js
           * {
           *   domain: {
           *     name: "*.example.com"
           *   }
           * }
           * ```
           */
          name: Input<string>;
          /**
           * Alias domains that should be used.
           *
           * @example
           * ```js {4}
           * {
           *   domain: {
           *     name: "app1.example.com",
           *     aliases: ["app2.example.com"]
           *   }
           * }
           * ```
           */
          aliases?: Input<string[]>;
          /**
           * The ARN of an ACM (AWS Certificate Manager) certificate that proves ownership of the
           * domain. By default, a certificate is created and validated automatically.
           *
           * :::tip
           * You need to pass in a `cert` for domains that are not hosted on supported `dns` providers.
           * :::
           *
           * To manually set up a domain on an unsupported provider, you'll need to:
           *
           * 1. [Validate that you own the domain](https://docs.aws.amazon.com/acm/latest/userguide/domain-ownership-validation.html) by creating an ACM certificate. You can either validate it by setting a DNS record or by verifying an email sent to the domain owner.
           * 2. Once validated, set the certificate ARN as the `cert` and set `dns` to `false`.
           * 3. Add the DNS records in your provider to point to the load balancer endpoint.
           *
           * @example
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: false,
           *     cert: "arn:aws:acm:us-east-1:112233445566:certificate/3a958790-8878-4cdc-a396-06d95064cf63"
           *   }
           * }
           * ```
           */
          cert?: Input<string>;
          /**
           * The DNS provider to use for the domain. Defaults to the AWS.
           *
           * Takes an adapter that can create the DNS records on the provider. This can automate
           * validating the domain and setting up the DNS routing.
           *
           * Supports Route 53, Cloudflare, and Vercel adapters. For other providers, you'll need
           * to set `dns` to `false` and pass in a certificate validating ownership via `cert`.
           *
           * @default `sst.aws.dns`
           *
           * @example
           *
           * Specify the hosted zone ID for the Route 53 domain.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.aws.dns({
           *       zone: "Z2FDTNDATAQYW2"
           *     })
           *   }
           * }
           * ```
           *
           * Use a domain hosted on Cloudflare, needs the Cloudflare provider.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.cloudflare.dns()
           *   }
           * }
           * ```
           *
           * Use a domain hosted on Vercel, needs the Vercel provider.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.vercel.dns()
           *   }
           * }
           * ```
           */
          dns?: Input<false | (Dns & {})>;
        }
    >;
    /**
     * Configure the mapping for the ports the load balancer listens to, forwards, or redirects to
     * the service.
     * This supports two types of protocols:
     *
     * 1. Application Layer Protocols: `http` and `https`. This'll create an [Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html).
     * 2. Network Layer Protocols: `tcp`, `udp`, `tcp_udp`, and `tls`. This'll create a [Network Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html).
     *
     * :::note
     * If you want to listen on `https` or `tls`, you need to specify a custom
     * `loadBalancer.domain`.
     * :::
     *
     * You **can not configure** both application and network layer protocols for the same
     * service.
     *
     * @example
     * Here we are listening on port `80` and forwarding it to the service on port `8080`.
     * ```js
     * {
     *   ports: [
     *     { listen: "80/http", forward: "8080/http" }
     *   ]
     * }
     * ```
     *
     * The `forward` port and protocol defaults to the `listen` port and protocol. So in this
     * case both are `80/http`.
     *
     * ```js
     * {
     *   ports: [
     *     { listen: "80/http" }
     *   ]
     * }
     * ```
     *
     * If multiple containers are configured via the `containers` argument, you need to
     * specify which container the traffic should be forwarded to.
     *
     * ```js
     * {
     *   ports: [
     *     { listen: "80/http", container: "app" },
     *     { listen: "8000/http", container: "admin" }
     *   ]
     * }
     * ```
     *
     * You can also route the same port to multiple containers via path-based routing.
     *
     * ```js
     * {
     *   ports: [
     *     { listen: "80/http", container: "app", path: "/api/*" },
     *     { listen: "80/http", container: "admin", path: "/admin/*" }
     *   ]
     * }
     * ```
     *
     * Additionally, you can redirect traffic from one port to another. This is
     * commonly used to redirect http to https.
     *
     * ```js
     * {
     *   ports: [
     *     { listen: "80/http", redirect: "443/https" },
     *     { listen: "443/https", forward: "80/http" }
     *   ]
     * }
     * ```
     */
    ports: Input<
      {
        /**
         * The port and protocol the service listens on. Uses the format `{port}/{protocol}`.
         */
        listen: Input<Port>;
        /**
         * The port and protocol of the container the service forwards the traffic to. Uses the
         * format `{port}/{protocol}`.
         * @default The same port and protocol as `listen`.
         */
        forward?: Input<Port>;
        /**
         * Configure path-based routing. Only requests matching the path are forwarded to
         * the container. Only applicable to "http" protocols.
         *
         * The path pattern is case-sensitive, supports wildcards, and can be up to 128
         * characters.
         * - `*` matches 0 or more characters.
         * - `?` matches exactly 1 character.
         *
         * For example:
         * - `/api/*`
         * - `/api/*.png
         *
         * @default Requests to all paths are forwarded.
         */
        path?: Input<string>;
        /**
         * Configure query string based routing. Only requests matching the query string are
         * forwarded to the container. Only applicable to "http" protocols.
         *
         * The query string pattern supports exact matches and wildcards.
         *
         * For example:
         * - `version=v1`
         * - `env=*`
         * - `env=prod&version=v1`
         *
         * @default Requests with any query string are forwarded.
         */
        queryString?: Input<string>;
        /**
         * The name of the container to forward the traffic to.
         *
         * You need this if there's more than one container.
         *
         * If there is only one container, the traffic is automatically forwarded to that
         * container.
         */
        container?: Input<string>;
        /**
         * The port and protocol to redirect the traffic to. Uses the format `{port}/{protocol}`.
         */
        redirect?: Input<Port>;
      }[]
    >;
    /**
     * Configure the health check that the load balancer runs on your containers.
     *
     * :::tip
     * This health check is different from the [`health`](#health) check.
     * :::
     *
     * This health check is run by the load balancer. While, `health` is run by ECS. This
     * cannot be disabled if you are using a load balancer. While the other is off by default.
     *
     * Since this cannot be disabled, here are some tips on how to debug an unhealthy
     * health check.
     *
     * <details>
     * <summary>How to debug a load balancer health check</summary>
     *
     * If you notice a `Unhealthy: Health checks failed` error, it's because the health
     * check has failed. When it fails, the load balancer will terminate the containers,
     * causing any requests to fail.
     *
     * Here's how to debug it:
     *
     * 1. Verify the health check path.
     *
     *    By default, the load balancer checks the `/` path. Ensure it's accessible in your
     *    containers. If your application runs on a different path, then update the path in
     *    the health check config accordingly.
     *
     * 2. Confirm the containers are operational.
     *
     *    Navigate to **ECS console** > select the **cluster** > go to the **Tasks tab** >
     *    choose **Any desired status** under the **Filter desired status** dropdown > select
     *    a task and check for errors under the **Logs tab**. If it has error that means that
     *    the container failed to start.
     *
     * 3. If the container was terminated by the load balancer while still starting up, try
     *    increasing the health check interval and timeout.
     * </details>
     *
     * For `http` and `https` the default is:
     *
     * ```js
     * {
     *   path: "/",
     *   healthyThreshold: 5,
     *   successCodes: "200",
     *   timeout: "5 seconds",
     *   unhealthyThreshold: 2,
     *   interval: "30 seconds"
     * }
     * ```
     *
     * For `tcp` and `udp` the default is:
     *
     * ```js
     * {
     *   healthyThreshold: 5,
     *   timeout: "6 seconds",
     *   unhealthyThreshold: 2,
     *   interval: "30 seconds"
     * }
     * ```
     *
     * @example
     *
     * To configure the health check, we use the _port/protocol_ format. Here we are
     * configuring a health check that pings the `/health` path on port `8080`
     * every 10 seconds.
     *
     * ```js
     * {
     *   ports: [
     *     { listen: "80/http", forward: "8080/http" }
     *   ],
     *   health: {
     *     "8080/http": {
     *       path: "/health",
     *       interval: "10 seconds"
     *     }
     *   }
     * }
     * ```
     *
     */
    health?: Input<
      Record<
        Port,
        Input<{
          /**
           * The URL path to ping on the service for health checks. Only applicable to
           * `http` and `https` protocols.
           * @default `"/"`
           */
          path?: Input<string>;
          /**
           * The time period between each health check request. Must be between `5 seconds`
           * and `300 seconds`.
           * @default `"30 seconds"`
           */
          interval?: Input<DurationMinutes>;
          /**
           * The timeout for each health check request. If no response is received within this
           * time, it is considered failed. Must be between `2 seconds` and `120 seconds`.
           * @default `"5 seconds"`
           */
          timeout?: Input<DurationMinutes>;
          /**
           * The number of consecutive successful health check requests required to consider the
           * target healthy. Must be between 2 and 10.
           * @default `5`
           */
          healthyThreshold?: Input<number>;
          /**
           * The number of consecutive failed health check requests required to consider the
           * target unhealthy. Must be between 2 and 10.
           * @default `2`
           */
          unhealthyThreshold?: Input<number>;
          /**
           * One or more HTTP response codes the health check treats as successful. Only
           * applicable to `http` and `https` protocols.
           *
           * @default `"200"`
           * @example
           * ```js
           * {
           *   successCodes: "200-299"
           * }
           * ```
           */
          successCodes?: Input<string>;
        }>
      >
    >;
  }>;
  /**
   * Configure the CloudMap service registry for the service.
   *
   * This creates an `srv` record in the CloudMap service. This is needed if you want to connect
   * an `ApiGatewayV2` VPC link to the service.
   *
   * API Gateway will forward requests to the given port on the service.
   *
   * @example
   * ```js
   * {
   *   serviceRegistry: {
   *     port: 80
   *   }
   * }
   * ```
   */
  serviceRegistry?: Input<{
    /**
     * The port in the service to forward requests to.
     */
    port: number;
  }>;
  /**
   * Configure the service to automatically scale up or down based on the CPU or memory
   * utilization of a container. By default, scaling is disabled and the service will run
   * in a single container.
   *
   * @default `{ min: 1, max: 1 }`
   *
   * @example
   * ```js
   * {
   *   scaling: {
   *     min: 4,
   *     max: 16,
   *     cpuUtilization: 50,
   *     memoryUtilization: 50
   *   }
   * }
   * ```
   */
  scaling?: Input<{
    /**
     * The minimum number of containers to scale down to.
     * @default `1`
     * @example
     * ```js
     * {
     *   scaling: {
     *     min: 4
     *   }
     * }
     * ```
     */
    min?: Input<number>;
    /**
     * The maximum number of containers to scale up to.
     * @default `1`
     * @example
     * ```js
     * {
     *   scaling: {
     *     max: 16
     *   }
     * }
     * ```
     */
    max?: Input<number>;
    /**
     * The target CPU utilization percentage to scale up or down. It'll scale up
     * when the CPU utilization is above the target and scale down when it's below the target.
     * @default `70`
     * @example
     * ```js
     * {
     *   scaling: {
     *     cpuUtilization: 50
     *   }
     * }
     * ```
     */
    cpuUtilization?: Input<false | number>;
    /**
     * The target memory utilization percentage to scale up or down. It'll scale up
     * when the memory utilization is above the target and scale down when it's below the target.
     * @default `70`
     * @example
     * ```js
     * {
     *   scaling: {
     *     memoryUtilization: 50
     *   }
     * }
     * ```
     */
    memoryUtilization?: Input<false | number>;
  }>;
  /**
   * Configure the health check that ECS runs on your containers.
   *
   * :::tip
   * This health check is different from the [`loadBalancer.health`](#loadbalancer-health) check.
   * :::
   *
   * This health check is run by ECS. While, `loadBalancer.health` is run by the load balancer,
   * if you are using one. This is off by default. While the load balancer one
   * cannot be disabled.
   *
   * This config maps to the `HEALTHCHECK` parameter of the `docker run` command. Learn
   * more about [container health checks](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_HealthCheck.html).
   *
   * @default Health check is disabled
   * @example
   * ```js
   * {
   *   health: {
   *     command: ["CMD-SHELL", "curl -f http://localhost:3000/ || exit 1"],
   *     startPeriod: "60 seconds",
   *     timeout: "5 seconds",
   *     interval: "30 seconds",
   *     retries: 3
   *   }
   * }
   * ```
   */
  health?: Input<{
    /**
     * A string array representing the command that the container runs to determine if it is
     * healthy.
     *
     * It must start with `CMD` to run the command arguments directly. Or `CMD-SHELL` to run
     * the command with the container's default shell.
     *
     * @example
     * ```js
     * {
     *   command: ["CMD-SHELL", "curl -f http://localhost:3000/ || exit 1"]
     * }
     * ```
     */
    command: Input<string[]>;
    /**
     * The grace period to provide containers time to bootstrap before failed health checks
     * count towards the maximum number of retries. Must be between `0 seconds` and
     * `300 seconds`.
     * @default `"0 seconds"`
     */
    startPeriod?: Input<DurationMinutes>;
    /**
     * The maximum time to allow one command to run. Must be between `2 seconds` and
     * `60 seconds`.
     * @default `"5 seconds"`
     */
    timeout?: Input<DurationMinutes>;
    /**
     * The time between running the command for the health check. Must be between `5 seconds`
     * and `300 seconds`.
     * @default `"30 seconds"`
     */
    interval?: Input<DurationMinutes>;
    /**
     * The number of consecutive failures required to consider the check to have failed. Must
     * be between `1` and `10`.
     * @default `3`
     */
    retries?: Input<number>;
  }>;
  /**
   * The containers to run in the service.
   *
   * :::tip
   * You can optionally run multiple containers in a service.
   * :::
   *
   * By default this starts a single container. To add multiple containers in the service, pass
   * in an array of containers args.
   *
   * ```ts
   * {
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: {
   *         context: "./admin",
   *         dockerfile: "Dockerfile"
   *       }
   *     }
   *   ]
   * }
   * ```
   *
   * If you specify `containers`, you cannot list the above args at the top-level. For example,
   * you **cannot** pass in `image` at the top level.
   *
   * ```diff lang="ts"
   * {
   * -  image: "nginxdemos/hello:plain-text",
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: "nginxdemos/hello:plain-text"
   *     }
   *   ]
   * }
   * ```
   *
   * You will need to pass in `image` as a part of the `containers`.
   */
  containers?: Input<Prettify<ServiceContainerArgs>>[];
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Docker Image resource.
     */
    image?: Transform<ImageArgs>;
    /**
     * Transform the ECS Execution IAM Role resource.
     */
    executionRole?: Transform<iam.RoleArgs>;
    /**
     * Transform the ECS Task IAM Role resource.
     */
    taskRole?: Transform<iam.RoleArgs>;
    /**
     * Transform the ECS Task Definition resource.
     */
    taskDefinition?: Transform<ecs.TaskDefinitionArgs>;
    /**
     * Transform the CloudWatch log group resource.
     */
    logGroup?: Transform<cloudwatch.LogGroupArgs>;
    /**
     * Transform the ECS Service resource.
     */
    service?: Transform<ecs.ServiceArgs>;
    /**
     * Transform the AWS Load Balancer resource.
     */
    loadBalancer?: Transform<lb.LoadBalancerArgs>;
    /**
     * Transform the AWS Security Group resource for the Load Balancer.
     */
    loadBalancerSecurityGroup?: Transform<ec2.SecurityGroupArgs>;
    /**
     * Transform the AWS Load Balancer listener resource.
     */
    listener?: Transform<lb.ListenerArgs>;
    /**
     * Transform the AWS Load Balancer target group resource.
     */
    target?: Transform<lb.TargetGroupArgs>;
    /**
     * Transform the AWS Application Auto Scaling target resource.
     */
    autoScalingTarget?: Transform<appautoscaling.TargetArgs>;
  };
}

export interface ClusterTaskArgs extends ClusterBaseArgs {
  /**
   * The containers to run in the task.
   *
   * :::tip
   * You can optionally run multiple containers in a task.
   * :::
   *
   * By default this starts a single container. To add multiple containers in the task, pass
   * in an array of containers args.
   *
   * ```ts
   * {
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: {
   *         context: "./admin",
   *         dockerfile: "Dockerfile"
   *       }
   *     }
   *   ]
   * }
   * ```
   *
   * If you specify `containers`, you cannot list the above args at the top-level. For example,
   * you **cannot** pass in `image` at the top level.
   *
   * ```diff lang="ts"
   * {
   * -  image: "nginxdemos/hello:plain-text",
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: "nginxdemos/hello:plain-text"
   *     }
   *   ]
   * }
   * ```
   *
   * You will need to pass in `image` as a part of the `containers`.
   */
  containers?: Input<Prettify<TaskContainerArgs>>[];
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` a _stub_ version of your task is deployed.
   * :::
   *
   * By default, your task in not deployed in `sst dev`. Instead, you can set the `dev.command`
   * and it'll run locally in a **Tasks** tab in the `sst dev` multiplexer.
   *
   * Here's what happens when you run `sst dev`:
   *
   * 1. A _stub_ version of your task is deployed. This is a minimal image that starts up
   *    faster.
   * 2. When your task is started through the SDK, the stub version is provisioned. This can
   *    take roughly **10 - 20 seconds**.
   * 3. The stub version proxies the payload to your local machine using the same events
   *    system used by [Live](/docs/live/).
   * 4. The `dev.command` is called to run your task locally. Once complete, the stub version
   *    of your task is stopped as well.
   *
   * The advantage with this approach is that you can test your task locally even it's invoked
   * remotely, or through a cron job.
   *
   * :::note
   * You are charged for the time it takes to run the stub version of your task.
   * :::
   *
   * Since the stub version runs while your task is running, you are charged for the time it
   * takes to run. This is roughly **$0.02 per hour**.
   *
   * To disable this and deploy your task in `sst dev`, pass in `false`. Read more about
   * [Live](/docs/live/) and [`sst dev`](/docs/reference/cli/#dev).
   */
  dev?:
    | false
    | {
        /**
         * The command that `sst dev` runs in dev mode.
         */
        command?: Input<string>;
        /**
         * Change the directory from where the `command` is run.
         * @default Uses the `image.dockerfile` path
         */
        directory?: Input<string>;
      };
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Docker Image resource.
     */
    image?: Transform<ImageArgs>;
    /**
     * Transform the ECS Execution IAM Role resource.
     */
    executionRole?: Transform<iam.RoleArgs>;
    /**
     * Transform the ECS Task IAM Role resource.
     */
    taskRole?: Transform<iam.RoleArgs>;
    /**
     * Transform the ECS Task Definition resource.
     */
    taskDefinition?: Transform<ecs.TaskDefinitionArgs>;
    /**
     * Transform the CloudWatch log group resource.
     */
    logGroup?: Transform<cloudwatch.LogGroupArgs>;
  };
}

/**
 * The `Cluster` component lets you create a cluster of containers to your app. It uses
 * [Amazon ECS](https://aws.amazon.com/ecs/) on [AWS Fargate](https://aws.amazon.com/fargate/).
 *
 * @example
 *
 * #### Create a Cluster
 *
 * ```ts title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const cluster = new sst.aws.Cluster("MyCluster", { vpc });
 * ```
 *
 * Once created, you can add the following to your cluster:
 *
 * - Services: These are containers that are always running, like web or application servers.
 *   They automatically restart if they fail.
 * - Tasks: These are containers that are used for long running asynchronous work, like data
 *   processing.
 *
 * ---
 *
 * ### Services
 *
 * Add a service to your cluster.
 *
 * ```ts title="sst.config.ts"
 * cluster.addService("MyService");
 * ```
 *
 * #### Configure the container image
 *
 * By default, the service will look for a Dockerfile in the root directory. Optionally
 * configure the image context and dockerfile.
 *
 * ```ts title="sst.config.ts"
 * cluster.addService("MyService", {
 *   image: {
 *     context: "./app",
 *     dockerfile: "Dockerfile"
 *   }
 * });
 * ```
 *
 * #### Enable auto-scaling
 *
 * ```ts title="sst.config.ts"
 * cluster.addService("MyService", {
 *   scaling: {
 *     min: 4,
 *     max: 16,
 *     cpuUtilization: 50,
 *     memoryUtilization: 50,
 *   }
 * });
 * ```
 *
 * #### Expose through API Gateway
 *
 * You can give your service a public URL by exposing it through API Gateway HTTP API. You can
 * also optionally give it a custom domain.
 *
 * ```ts title="sst.config.ts"
 * const service = cluster.addService("MyService", {
 *   serviceRegistry: {
 *     port: 80,
 *   },
 * });
 *
 * const api = new sst.aws.ApiGatewayV2("MyApi", {
 *   vpc,
 *   domain: "example.com"
 * });
 * api.routePrivate("$default", service.nodes.cloudmapService.arn);
 * ```
 *
 * #### Add a load balancer
 *
 * You can also expose your service by adding a load balancer to it and optionally adding a
 * custom domain.
 *
 * ```ts title="sst.config.ts"
 * cluster.addService("MyService", {
 *   loadBalancer: {
 *     domain: "example.com",
 *     ports: [
 *       { listen: "80/http" },
 *       { listen: "443/https", forward: "80/http" },
 *     ]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your service. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * cluster.addService("MyService", {
 *   link: [bucket],
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources in your service.
 *
 * ```ts title="app.ts"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 *
 * ---
 *
 * ### Tasks
 *
 * Add a task to your cluster.
 *
 * ```ts title="sst.config.ts"
 * const task = cluster.addTask("MyTask");
 * ```
 *
 * #### Configure the container image
 *
 * By default, the task will look for a Dockerfile in the root directory. Optionally
 * configure the image context and dockerfile.
 *
 * ```ts title="sst.config.ts"
 * cluster.addTask("MyTask", {
 *   image: {
 *     context: "./app",
 *     dockerfile: "Dockerfile"
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your task. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * cluster.addTask("MyTask", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources in your task.
 *
 * ```ts title="app.ts"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 *
 * #### Task SDK
 *
 * With the [Task JS SDK](/docs/component/aws/task#sdk), you can run your tasks, stop your
 * tasks, and get the status of your tasks.
 *
 * For example, you can link the task to a function in your app.
 *
 * ```ts title="sst.config.ts" {3}
 * new sst.aws.Function("MyFunction", {
 *   handler: "src/lambda.handler",
 *   link: [task]
 * });
 * ```
 *
 * Then from your function start the task.
 *
 * ```ts title="src/lambda.ts"
 * import { Resource } from "sst";
 * import { task } from "sst/aws/task";
 *
 * const runRet = await task.run(Resource.MyTask);
 * const taskArn = runRet.tasks[0].taskArn;
 * ```
 *
 * If you are not using Node.js, you can use the AWS SDK instead. Here's
 * [how to run a task](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html).
 *
 * ---
 *
 * ### Cost
 *
 * By default, this uses a _Linux/X86_ _Fargate_ container with 0.25 vCPUs at $0.04048 per
 * vCPU per hour and 0.5 GB of memory at $0.004445 per GB per hour. It includes 20GB of
 * _Ephemeral Storage_ for free with additional storage at $0.000111 per GB per hour. Each
 * container also gets a public IPv4 address at $0.005 per hour.
 *
 * For a service, works out to $0.04048 x 0.25 x 24 x 30 + $0.004445 x 0.5 x 24 x 30 + $0.005
 * x 24 x 30 or **$13 per month**.
 *
 * For a task, it works out to $0.04048 x 0.25 + $0.004445 x 0.5 + $0.005. Or **$0.02 per hour**
 * your task runs for.
 *
 * Adjust this for the `cpu`, `memory` and `storage` you are using. And
 * check the prices for _Linux/ARM_ if you are using `arm64` as your `architecture`.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [Fargate pricing](https://aws.amazon.com/fargate/pricing/) and the
 * [Public IPv4 Address pricing](https://aws.amazon.com/vpc/pricing/) for more details.
 *
 * #### Scaling
 *
 * By default, `scaling` is disabled. If enabled, adjust the above for the number of containers.
 *
 * Scaling doesn't apply to tasks.
 *
 * #### API Gateway
 *
 * If you expose your service through API Gateway, you'll need to add the cost of
 * [API Gateway HTTP API](https://aws.amazon.com/api-gateway/pricing/#HTTP_APIs) as well.
 * For services that don't get a lot of traffic, this ends up being a lot cheaper since API
 * Gateway is pay per request.
 *
 * Learn more about using
 * [Cluster with API Gateway](/docs/examples/#aws-cluster-with-api-gateway).
 *
 * #### Application Load Balancer
 *
 * If you add `loadBalancer` _HTTP_ or _HTTPS_ `ports`, an ALB is created at $0.0225 per hour,
 * $0.008 per LCU-hour, and $0.005 per hour if HTTPS with a custom domain is used. Where LCU
 * is a measure of how much traffic is processed.
 *
 * That works out to $0.0225 x 24 x 30 or **$16 per month**. Add $0.005 x 24 x 30 or **$4 per
 * month** for HTTPS. Also add the LCU-hour used.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [Application Load Balancer pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
 * for more details.
 *
 * #### Network Load Balancer
 *
 * If you add `loadBalancer` _TCP_, _UDP_, or _TLS_ `ports`, an NLB is created at $0.0225 per hour and
 * $0.006 per NLCU-hour. Where NCLU is a measure of how much traffic is processed.
 *
 * That works out to $0.0225 x 24 x 30 or **$16 per month**. Also add the NLCU-hour used.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [Network Load Balancer pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
 * for more details.
 */
export class Cluster extends Component {
  private constructorOpts: ComponentResourceOptions;
  private cluster: ecs.Cluster;
  private vpc: Vpc | Output<Prettify<ClusterVpcsNormalizedArgs>>;
  public static v1 = ClusterV1;

  constructor(
    name: string,
    args: ClusterArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
    const _version = 2;
    const self = this;

    self.registerVersion({
      new: _version,
      old: $cli.state.version[name],
      message: [
        `There is a new version of "Cluster" that has breaking changes.`,
        ``,
        `What changed:`,
        `  - In the old version, load balancers were deployed in public subnets, and services were deployed in private subnets. The VPC was required to have NAT gateways.`,
        `  - In the latest version, both the load balancer and the services are deployed in public subnets. The VPC is not required to have NAT gateways. So the new default makes this cheaper to run.`,
        ``,
        `To upgrade:`,
        `  - Set \`forceUpgrade: "v${_version}"\` on the "Cluster" component. Learn more https://sst.dev/docs/component/aws/cluster#forceupgrade`,
        ``,
        `To continue using v${$cli.state.version[name]}:`,
        `  - Rename "Cluster" to "Cluster.v${$cli.state.version[name]}". Learn more about versioning - https://sst.dev/docs/components/#versioning`,
      ].join("\n"),
      forceUpgrade: args.forceUpgrade,
    });

    const vpc = normalizeVpc();
    const cluster = createCluster();

    this.constructorOpts = opts;
    this.cluster = cluster;
    this.vpc = vpc;

    function normalizeVpc() {
      // "vpc" is a Vpc.v1 component
      if (args.vpc instanceof VpcV1) {
        throw new VisibleError(
          `You are using the "Vpc.v1" component. Please migrate to the latest "Vpc" component.`,
        );
      }

      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return args.vpc;
      }

      // "vpc" is object
      return output(args.vpc).apply((vpc) => {
        if (vpc.containerSubnets && vpc.serviceSubnets)
          throw new VisibleError(
            `You cannot provide both "vpc.containerSubnets" and "vpc.serviceSubnets" in the "${name}" Cluster component. The "serviceSubnets" property has been deprecated. Use "containerSubnets" instead.`,
          );
        if (!vpc.containerSubnets && !vpc.serviceSubnets)
          throw new VisibleError(
            `Missing "vpc.containerSubnets" for the "${name}" Cluster component.`,
          );

        return {
          ...vpc,
          containerSubnets: (vpc.containerSubnets ?? vpc.serviceSubnets)!,
          serviceSubnets: undefined,
        };
      });
    }

    function createCluster() {
      return new ecs.Cluster(
        ...transform(
          args.transform?.cluster,
          `${name}Cluster`,
          {},
          { parent: self },
        ),
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon ECS Cluster.
       */
      cluster: this.cluster,
    };
  }

  /**
   * Add a service to the cluster.
   *
   * @param name Name of the service.
   * @param args Configure the service.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * cluster.addService("MyService");
   * ```
   *
   * You can also configure the service. For example, set a custom domain.
   *
   * ```js {2} title="sst.config.ts"
   * cluster.addService("MyService", {
   *   domain: "example.com"
   * });
   * ```
   *
   * Enable auto-scaling.
   *
   * ```ts title="sst.config.ts"
   * cluster.addService("MyService", {
   *   scaling: {
   *     min: 4,
   *     max: 16,
   *     cpuUtilization: 50,
   *     memoryUtilization: 50,
   *   }
   * });
   * ```
   *
   * By default this starts a single container. To add multiple containers in the service, pass in an array of containers args.
   *
   * ```ts title="sst.config.ts"
   * cluster.addService("MyService", {
   *   architecture: "arm64",
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: {
   *         context: "./admin",
   *         dockerfile: "Dockerfile"
   *       }
   *     }
   *   ]
   * });
   * ```
   *
   * This is useful for running sidecar containers.
   */
  public addService(name: string, args?: ClusterServiceArgs) {
    // Do not prefix the service to allow `Resource.MyService` to work.
    return new Service(
      name,
      {
        cluster: this,
        vpc: this.vpc,
        ...args,
      },
      { provider: this.constructorOpts.provider },
    );
  }

  /**
   * Add a task to the cluster.
   *
   * @param name Name of the task.
   * @param args Configure the task.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * cluster.addTask("MyTask");
   * ```
   *
   * You can also configure the task. By default this starts a single container.
   * To add multiple containers in the task, pass in an array of containers args.
   *
   * ```ts title="sst.config.ts"
   * cluster.addTask("MyTask", {
   *   architecture: "arm64",
   *   containers: [
   *     {
   *       name: "app",
   *       image: "nginxdemos/hello:plain-text"
   *     },
   *     {
   *       name: "admin",
   *       image: {
   *         context: "./admin",
   *         dockerfile: "Dockerfile"
   *       }
   *     }
   *   ]
   * });
   * ```
   *
   * This is useful for running sidecar containers.
   */
  public addTask(name: string, args?: ClusterTaskArgs) {
    // Do not prefix the task to allow `Resource.MyTask` to work.
    return new Task(
      name,
      {
        cluster: this,
        vpc: this.vpc,
        ...args,
      },
      { provider: this.constructorOpts.provider },
    );
  }
}

export function normalizeArchitecture(args: ClusterTaskArgs) {
  return output(args.architecture ?? "x86_64").apply((v) => v);
}

export function normalizeCpu(args: ClusterTaskArgs) {
  return output(args.cpu ?? "0.25 vCPU").apply((v) => {
    if (!supportedCpus[v]) {
      throw new Error(
        `Unsupported CPU: ${v}. The supported values for CPU are ${Object.keys(
          supportedCpus,
        ).join(", ")}`,
      );
    }
    return v;
  });
}

export function normalizeMemory(
  cpu: ReturnType<typeof normalizeCpu>,
  args: ClusterTaskArgs,
) {
  return all([cpu, args.memory ?? "0.5 GB"]).apply(([cpu, v]) => {
    if (!(v in supportedMemories[cpu])) {
      throw new Error(
        `Unsupported memory: ${v}. The supported values for memory for a ${cpu} CPU are ${Object.keys(
          supportedMemories[cpu],
        ).join(", ")}`,
      );
    }
    return v;
  });
}

export function normalizeStorage(args: ClusterTaskArgs) {
  return output(args.storage ?? "20 GB").apply((v) => {
    const storage = toGBs(v);
    if (storage < 20 || storage > 200)
      throw new Error(
        `Unsupported storage: ${v}. The supported value for storage is between "20 GB" and "200 GB"`,
      );
    return v;
  });
}

export function normalizeContainers(
  type: "service" | "task",
  args: ClusterServiceArgs,
  name: string,
  architecture: ReturnType<typeof normalizeArchitecture>,
) {
  if (
    args.containers &&
    (args.image ||
      args.logging ||
      args.environment ||
      args.volumes ||
      args.health ||
      args.ssm)
  ) {
    throw new VisibleError(
      type === "service"
        ? `You cannot provide both "containers" and "image", "logging", "environment", "volumes", "health" or "ssm".`
        : `You cannot provide both "containers" and "image", "logging", "environment", "volumes" or "ssm".`,
    );
  }

  // Standardize containers
  const containers = args.containers ?? [
    {
      name: name,
      cpu: undefined,
      memory: undefined,
      image: args.image,
      logging: args.logging,
      environment: args.environment,
      ssm: args.ssm,
      volumes: args.volumes,
      command: args.command,
      entrypoint: args.entrypoint,
      health: type === "service" ? args.health : undefined,
      dev: type === "service" ? args.dev : undefined,
    },
  ];

  // Normalize container props
  return output(containers).apply((containers) =>
    containers.map((v) => {
      return {
        ...v,
        volumes: normalizeVolumes(),
        image: normalizeImage(),
        logging: normalizeLogging(),
      };

      function normalizeVolumes() {
        return output(v.volumes).apply(
          (volumes) =>
            volumes?.map((volume) => ({
              path: volume.path,
              efs:
                volume.efs instanceof Efs
                  ? {
                      fileSystem: volume.efs.id,
                      accessPoint: volume.efs.accessPoint,
                    }
                  : volume.efs,
            })),
        );
      }

      function normalizeImage() {
        return all([v.image, architecture]).apply(([image, architecture]) => {
          if (typeof image === "string") return image;

          return {
            ...image,
            context: image?.context ?? ".",
            platform:
              architecture === "arm64"
                ? Platform.Linux_arm64
                : Platform.Linux_amd64,
          };
        });
      }

      function normalizeLogging() {
        return output(v.logging).apply((logging) => ({
          ...logging,
          retention: logging?.retention ?? "1 month",
        }));
      }
    }),
  );
}

export function createTaskRole(
  name: string,
  args: ClusterTaskArgs,
  opts: ComponentResourceOptions,
  parent: Component,
  additionalPermissions?: FunctionArgs["permissions"],
) {
  if (args.taskRole)
    return iam.Role.get(`${name}TaskRole`, args.taskRole, {}, { parent });

  const policy = all([
    args.permissions || [],
    Link.getInclude<Permission>("aws.permission", args.link),
    additionalPermissions,
  ]).apply(([argsPermissions, linkPermissions, additionalPermissions]) =>
    iam.getPolicyDocumentOutput({
      statements: [
        ...argsPermissions,
        ...linkPermissions.map((item) => ({
          actions: item.actions,
          resources: item.resources,
        })),
        ...(additionalPermissions ?? []),
        {
          actions: [
            "ssmmessages:CreateControlChannel",
            "ssmmessages:CreateDataChannel",
            "ssmmessages:OpenControlChannel",
            "ssmmessages:OpenDataChannel",
          ],
          resources: ["*"],
        },
      ],
    }),
  );

  return new iam.Role(
    ...transform(
      args.transform?.taskRole,
      `${name}TaskRole`,
      {
        assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
          Service: "ecs-tasks.amazonaws.com",
        }),
        inlinePolicies: policy.apply(({ statements }) =>
          statements ? [{ name: "inline", policy: policy.json }] : [],
        ),
      },
      { parent },
    ),
  );
}

export function createExecutionRole(
  name: string,
  args: ClusterTaskArgs,
  opts: ComponentResourceOptions,
  parent: Component,
) {
  if (args.executionRole)
    return iam.Role.get(
      `${name}ExecutionRole`,
      args.executionRole,
      {},
      { parent },
    );

  const partition = getPartitionOutput({}, opts).partition;
  return new iam.Role(
    ...transform(
      args.transform?.executionRole,
      `${name}ExecutionRole`,
      {
        assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
          Service: "ecs-tasks.amazonaws.com",
        }),
        managedPolicyArns: [
          interpolate`arn:${partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy`,
        ],
        inlinePolicies: [
          {
            name: "inline",
            policy: iam.getPolicyDocumentOutput({
              statements: [
                {
                  sid: "ReadSsmAndSecrets",
                  actions: [
                    "ssm:GetParameters",
                    "ssm:GetParameter",
                    "ssm:GetParameterHistory",
                    "secretsmanager:GetSecretValue",
                  ],
                  resources: ["*"],
                },
              ],
            }).json,
          },
        ],
      },
      { parent },
    ),
  );
}

export function createTaskDefinition(
  name: string,
  args: ServiceArgs,
  opts: ComponentResourceOptions,
  parent: Component,
  containers: ReturnType<typeof normalizeContainers>,
  architecture: ReturnType<typeof normalizeArchitecture>,
  cpu: ReturnType<typeof normalizeCpu>,
  memory: ReturnType<typeof normalizeMemory>,
  storage: ReturnType<typeof normalizeStorage>,
  taskRole: ReturnType<typeof createTaskRole>,
  executionRole: ReturnType<typeof createExecutionRole>,
) {
  const clusterName = args.cluster.nodes.cluster.name;
  const region = getRegionOutput({}, opts).name;
  const bootstrapData = region.apply((region) => bootstrap.forRegion(region));
  const containerDefinitions = all([
    containers,
    Link.propertiesToEnv(Link.getProperties(args.link)),
  ]).apply(([containers, linkEnvs]) =>
    containers.map((container) => ({
      name: container.name,
      image: (() => {
        if (typeof container.image === "string") return output(container.image);

        const contextPath = path.join($cli.paths.root, container.image.context);
        const dockerfile = container.image.dockerfile ?? "Dockerfile";
        const dockerfilePath = container.image.dockerfile
          ? path.join($cli.paths.root, container.image.dockerfile)
          : path.join($cli.paths.root, container.image.context, "Dockerfile");
        const dockerIgnorePath = fs.existsSync(
          path.join(contextPath, `${dockerfile}.dockerignore`),
        )
          ? path.join(contextPath, `${dockerfile}.dockerignore`)
          : path.join(contextPath, ".dockerignore");

        // add .sst to .dockerignore if not exist
        const lines = fs.existsSync(dockerIgnorePath)
          ? fs.readFileSync(dockerIgnorePath).toString().split("\n")
          : [];
        if (!lines.find((line) => line === ".sst")) {
          fs.writeFileSync(
            dockerIgnorePath,
            [...lines, "", "# sst", ".sst"].join("\n"),
          );
        }

        // Build image
        const image = imageBuilder(
          ...transform(
            args.transform?.image,
            `${name}Image${container.name}`,
            {
              context: { location: contextPath },
              dockerfile: { location: dockerfilePath },
              buildArgs: {
                ...container.image.args,
                ...linkEnvs,
              },
              target: container.image.target,
              platforms: [container.image.platform],
              tags: [container.name, ...(container.image.tags ?? [])].map(
                (tag) => interpolate`${bootstrapData.assetEcrUrl}:${tag}`,
              ),
              registries: [
                ecr
                  .getAuthorizationTokenOutput(
                    {
                      registryId: bootstrapData.assetEcrRegistryId,
                    },
                    { parent },
                  )
                  .apply((authToken) => ({
                    address: authToken.proxyEndpoint,
                    password: secret(authToken.password),
                    username: authToken.userName,
                  })),
              ],
              cacheFrom: [
                {
                  registry: {
                    ref: interpolate`${bootstrapData.assetEcrUrl}:${container.name}-cache`,
                  },
                },
              ],
              cacheTo: [
                {
                  registry: {
                    ref: interpolate`${bootstrapData.assetEcrUrl}:${container.name}-cache`,
                    imageManifest: true,
                    ociMediaTypes: true,
                    mode: "max",
                  },
                },
              ],
              push: true,
            },
            { parent },
          ),
        );

        return interpolate`${bootstrapData.assetEcrUrl}@${image.digest}`;
      })(),
      cpu: container.cpu ? toNumber(container.cpu) : undefined,
      memory: container.memory ? toMBs(container.memory) : undefined,
      command: container.command,
      entrypoint: container.entrypoint,
      healthCheck: container.health && {
        command: container.health.command,
        startPeriod: toSeconds(container.health.startPeriod ?? "0 seconds"),
        timeout: toSeconds(container.health.timeout ?? "5 seconds"),
        interval: toSeconds(container.health.interval ?? "30 seconds"),
        retries: container.health.retries ?? 3,
      },
      pseudoTerminal: true,
      portMappings: [{ containerPortRange: "1-65535" }],
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": (() => {
            return new cloudwatch.LogGroup(
              ...transform(
                args.transform?.logGroup,
                `${name}LogGroup${container.name}`,
                {
                  name: interpolate`/sst/cluster/${clusterName}/${name}/${container.name}`,
                  retentionInDays: RETENTION[container.logging.retention],
                },
                { parent },
              ),
            );
          })().name,
          "awslogs-region": region,
          "awslogs-stream-prefix": "/service",
        },
      },
      environment: Object.entries({
        ...container.environment,
        ...linkEnvs,
      }).map(([name, value]) => ({ name, value })),
      linuxParameters: {
        initProcessEnabled: true,
      },
      mountPoints: container.volumes?.map((volume) => ({
        sourceVolume: volume.efs.accessPoint,
        containerPath: volume.path,
      })),
      secrets: Object.entries(container.ssm ?? {}).map(([name, valueFrom]) => ({
        name,
        valueFrom,
      })),
    })),
  );

  return storage.apply(
    (storage) =>
      new ecs.TaskDefinition(
        ...transform(
          args.transform?.taskDefinition,
          `${name}Task`,
          {
            family: interpolate`${clusterName}-${name}`,
            trackLatest: true,
            cpu: cpu.apply((v) => toNumber(v).toString()),
            memory: memory.apply((v) => toMBs(v).toString()),
            networkMode: "awsvpc",
            ephemeralStorage: (() => {
              const sizeInGib = toGBs(storage);
              return sizeInGib === 20 ? undefined : { sizeInGib };
            })(),
            requiresCompatibilities: ["FARGATE"],
            runtimePlatform: {
              cpuArchitecture: architecture.apply((v) => v.toUpperCase()),
              operatingSystemFamily: "LINUX",
            },
            executionRoleArn: executionRole.arn,
            taskRoleArn: taskRole.arn,
            volumes: output(containers).apply((containers) => {
              const uniqueAccessPoints: Set<string> = new Set();
              return containers.flatMap((container) =>
                (container.volumes ?? []).flatMap((volume) => {
                  if (uniqueAccessPoints.has(volume.efs.accessPoint)) return [];
                  uniqueAccessPoints.add(volume.efs.accessPoint);
                  return {
                    name: volume.efs.accessPoint,
                    efsVolumeConfiguration: {
                      fileSystemId: volume.efs.fileSystem,
                      transitEncryption: "ENABLED",
                      authorizationConfig: {
                        accessPointId: volume.efs.accessPoint,
                      },
                    },
                  };
                }),
              );
            }),
            containerDefinitions: $jsonStringify(containerDefinitions),
          },
          { parent },
        ),
      ),
  );
}

const __pulumiType = "sst:aws:Cluster";
// @ts-expect-error
Cluster.__pulumiType = __pulumiType;
