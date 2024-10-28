import { ComponentResourceOptions } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Input } from "../input";
import { Dns } from "../dns";
import { FunctionArgs } from "./function";
import { Service } from "./service";
import { RETENTION } from "./logging.js";
import { cloudwatch, ec2, ecs, iam, lb } from "@pulumi/aws";
import { ImageArgs } from "@pulumi/docker-build";
import { Cluster as ClusterV1 } from "./cluster-v1";
import { Vpc } from "./vpc";
import { Efs } from "./efs";
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
   *     loadBalancerSubnets: myVpc.publicSubnets,
   *     serviceSubnets: myVpc.publicSubnets,
   *     securityGroups: myVpc.securityGroups,
   *     cloudmapNamespaceId: myVpc.nodes.cloudmapNamespace.id,
   *     cloudmapNamespaceName: myVpc.nodes.cloudmapNamespace.name,
   *   }
   * }
   * ```
   */
  vpc:
    | Vpc
    | Input<{
        /**
         * The ID of the VPC.
         */
        id: Input<string>;
        /**
         * A list of subnet IDs in the VPC to place the load balancer in.
         */
        loadBalancerSubnets: Input<Input<string>[]>;
        /**
         * A list of private subnet IDs in the VPC to place the services in.
         */
        serviceSubnets: Input<Input<string>[]>;
        /**
         * A list of VPC security group IDs for the service.
         */
        securityGroups: Input<Input<string>[]>;
        /**
         * The ID of the Cloud Map namespace to use for the service.
         */
        cloudmapNamespaceId: Input<string>;
        /**
         * The name of the Cloud Map namespace to use for the service.
         */
        cloudmapNamespaceName: Input<string>;
      }>;
  /**
   * Force upgrade from `Cluster.v1` to the latest `Cluster` version. The only valid value
   * is `v2`, which is the version of the new `Cluster`.
   *
   * In `Cluster.v1`, load balancers are deployed in public subnets, and services are
   * deployed in private subnets. The VPC is required to have NAT gateways.
   *
   * In the latest `Cluster`, both the load balancer and the services are deployed in
   * public subnets. The VPC is not required to have NAT gateways. So the new default makes
   * this cheaper to run.
   *
   * To upgrade, add the prop.
   *
   * ```ts
   * {
   *   forceUpgrade: "v2"
   * }
   * ```
   *
   * Run `sst deploy`.
   *
   * :::tip
   * You can remove this prop after you upgrade.
   * :::
   *
   * This upgrades your component and the resources it created. You can now optionally
   * remove the prop.
   *
   * After the upgrade, new services will be deployed in public subnets.
   *
   * :::caution
   * New service will be deployed in public subnets.
   * :::
   *
   * To continue deploying in private subnets, set `vpc.serviceSubnets` to a list of
   * private subnets.
   *
   * ```js title="sst.config.ts" {4,8}
   * const myVpc = new sst.aws.Vpc("MyVpc", { nat: "managed" });
   *
   * const cluster = new sst.aws.Cluster("MyCluster", {
   *   forceUpgrade: "v2",
   *   vpc: {
   *     id: myVpc.id,
   *     loadBalancerSubnets: myVpc.publicSubnets,
   *     serviceSubnets: myVpc.privateSubnets,
   *     securityGroups: myVpc.securityGroups,
   *     cloudmapNamespaceId: myVpc.nodes.cloudmapNamespace.id,
   *     cloudmapNamespaceName: myVpc.nodes.cloudmapNamespace.name,
   *   }
   * });
   * ```
   */
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

export interface ClusterServiceArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your service is not deployed.
   * :::
   *
   *  By default, your service in not deployed in `sst dev`. Instead, you can use the
   * `dev.command` to start your app locally. It'll be run as a separate process in the
   * `sst dev` multiplexer. Read more about [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode and deploy your service, pass in `false`.
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
   *
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
      }[]
    >;
  }>;
  /**
   * The CPU architecture of the container in this service.
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
   * The amount of CPU allocated to the container in this service.
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
   * The amount of memory allocated to the container in this service.
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
   * The amount of ephemeral storage (in GB) allocated to the container in this service.
   *
   * @default `"21 GB"`
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
   * [Link resources](/docs/linking/) to your service. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your app using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of components to link to the service.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: FunctionArgs["link"];
  /**
   * Permissions and the resources that the service needs to access. These permissions are
   * used to create the service's [task role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).
   *
   * :::tip
   * If you `link` the service to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow the service to read and write to an S3 bucket called `my-bucket`.
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
   * Allow the service to perform all actions on an S3 bucket called `my-bucket`.
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
   * Granting the service permissions to access all resources.
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
    cpuUtilization?: Input<number>;
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
    memoryUtilization?: Input<number>;
  }>;
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
   * The entrypoint to override the default entrypoint in the container.
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
   * - Start with a letter
   * - Be at least 2 characters long
   * - Contain only letters, numbers, or underscores
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
   * Configure the service's logs in CloudWatch.
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
   * The containers to run in the service.
   *
   * :::tip
   * You can optiionally run multiple containers in a service.
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
   * If you sepcify `containers`, you cannot list the above args at the top-level. For example,
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
  containers?: Input<{
    /**
     * The name of the container.
     *
     * This is used as the `--name` option in the Docker run command.
     */
    name: Input<string>;
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
     * Configure the service's logs in CloudWatch. Same as the top-level [`logging`](#logging).
     */
    logging?: Input<{
      /**
       * The duration the logs are kept in CloudWatch. Same as the top-level
       * [`logging.retention`](#logging-retention).
       */
      retention?: Input<keyof typeof RETENTION>;
    }>;
    /**
     * Mount Amazon EFS file systems into the container. Same as the top-level
     * [`efs`](#efs).
     */
    volumes?: ClusterServiceArgs["volumes"];
    /**
     * Configure how this container works in `sst dev`. Same as the top-level
     * [`dev`](#dev).
     */
    dev?: {
      /**
       * The command that `sst dev` runs to start this in dev mode. Same as the top-level
       * [`dev.command`](#dev-command).
       */
      command?: Input<string>;
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
  }>[];
  /**
   * Configure the health check for the service.
   */
  healthCheck?: {
    /**
     * Whether the health check is enabled.
     * @default `true`
     */
    enabled?: Input<boolean>;
    /**
     * The path to check for HTTP health checks.
     * @default `"/"`
     */
    path?: Input<string>;
    /**
     * The interval (in seconds) between health checks.
     * @default `30`
     */
    interval?: Input<number>;
    /**
     * The timeout (in seconds) for each health check.
     * @default `5`
     */
    timeout?: Input<number>;
    /**
     * The number of consecutive successful health checks required to consider the container healthy.
     * @default `2`
     */
    healthyThreshold?: Input<number>;
    /**
     * The number of consecutive failed health checks required to consider the container unhealthy.
     * @default `2`
     */
    unhealthyThreshold?: Input<number>;
  };
  /**
   * Assigns the given IAM role name to the containers running in the service. This allows you to pass in a previously created role.
   *
   * :::caution
   * When you pass in a role, the service will not update it if you add `permissions` or `link` resources.
   * :::
   *
   * By default, the service creates a new IAM role when it's created. It'll update this role if you add `permissions` or `link` resources.
   *
   * However, if you pass in a role, you'll need to update it manually if you add `permissions` or `link` resources.
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
   * Assigns the given IAM role name to AWS ECS to launch and manage the containers in the service. This allows you to pass in a previously created role.
   *
   * By default, the service creates a new IAM role when it's created.
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
     * Transform the ECS Service resource.
     */
    service?: Transform<ecs.ServiceArgs>;
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
     * Transform the CloudWatch log group resource.
     */
    logGroup?: Transform<cloudwatch.LogGroupArgs>;
  };
}

/**
 * The `Cluster` component lets you create a cluster of containers and add services to them.
 * It uses [Amazon ECS](https://aws.amazon.com/ecs/) on [AWS Fargate](https://aws.amazon.com/fargate/).
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
 * #### Add a service
 *
 * ```ts title="sst.config.ts"
 * cluster.addService("MyService");
 * ```
 *
 * #### Add a public custom domain
 *
 * ```ts title="sst.config.ts"
 * cluster.addService("MyService", {
 *   public: {
 *     domain: "example.com",
 *     ports: [
 *       { listen: "80/http" },
 *       { listen: "443/https", forward: "80/http" },
 *     ]
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
 * If your service is written in Node.js, you can use the [SDK](/docs/reference/sdk/)
 * to access the linked resources.
 *
 * ```ts title="app.ts"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
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
 * That works out to $0.04048 x 0.25 x 24 x 30 + $0.004445 x 0.5 x 24 x 30 + $0.005 x 24 x 30
 * or **$13 per month**.
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
 * #### Application Load Balancer
 *
 * If you add `public` _HTTP_ or _HTTPS_ `ports`, an ALB is created at $0.0225 per hour,
 * $0.008 per LCU-hour, and $0.005 per hour if HTTPS with a custom domain is used. Where LCU
 * is a measure of how much traffic is processed.
 *
 * That works out to $0.0225 x 24 x 30 or **$16 per month**. Add $0.005 x 24 x 30 or **$4 per
 * month** for HTTPS. And adjust this for the LCU-hour used.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [Application Load Balancer pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
 * for more details.
 *
 * #### Network Load Balancer
 *
 * If you add `public` _TCP_, _UDP_, or _TLS_ `ports`, an NLB is created at $0.0225 per hour and
 * $0.006 per NLCU-hour. Where NCLU is a measure of how much traffic is processed.
 *
 * That works out to $0.0225 x 24 x 30 or **$16 per month**. Adjust this for the NLCU-hour used.
 *
 * The above are rough estimates for _us-east-1_, check out the
 * [Network Load Balancer pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
 * for more details.
 */
export class Cluster extends Component {
  private constructorArgs: ClusterArgs;
  private constructorOpts: ComponentResourceOptions;
  private cluster: ecs.Cluster;
  public static v1 = ClusterV1;

  constructor(
    name: string,
    args: ClusterArgs,
    opts: ComponentResourceOptions = {},
  ) {
    const _version = 2;
    super(__pulumiType, name, args, opts, {
      _version,
      _message: [
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
      _forceUpgrade: args.forceUpgrade,
    });

    const parent = this;

    const cluster = createCluster();

    this.constructorArgs = args;
    this.constructorOpts = opts;
    this.cluster = cluster;

    function createCluster() {
      return new ecs.Cluster(
        ...transform(args.transform?.cluster, `${name}Cluster`, {}, { parent }),
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
        cluster: {
          name: this.cluster.name,
          arn: this.cluster.arn,
        },
        vpc: this.constructorArgs.vpc,
        ...args,
      },
      { provider: this.constructorOpts.provider },
    );
  }
}

const __pulumiType = "sst:aws:Cluster";
// @ts-expect-error
Cluster.__pulumiType = __pulumiType;
