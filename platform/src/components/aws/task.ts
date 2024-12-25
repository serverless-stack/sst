import { all, ComponentResourceOptions, Output, output } from "@pulumi/pulumi";
import { Component, Prettify } from "../component.js";
import { Link } from "../link.js";
import {
  Cluster,
  ClusterTaskArgs,
  ClusterVpcsNormalizedArgs,
  createExecutionRole,
  createTaskDefinition,
  createTaskRole,
  normalizeArchitecture,
  normalizeContainers,
  normalizeCpu,
  normalizeMemory,
  normalizeStorage,
} from "./cluster.js";
import { ecs, iam } from "@pulumi/aws";
import { permission } from "./permission.js";
import { Vpc } from "./vpc.js";
import { Function } from "./function.js";

export interface TaskArgs extends ClusterTaskArgs {
  /**
   * The cluster to use for the task.
   */
  cluster: Cluster;
  /**
   * The VPC to use for the cluster.
   */
  vpc: Vpc | Output<Prettify<ClusterVpcsNormalizedArgs>>;
}

/**
 * The `Task` component is internally used by the `Cluster` component to deploy tasks to
 * [Amazon ECS](https://aws.amazon.com/ecs/). It uses [AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).
 *
 * :::note
 * This component is not meant to be created directly.
 * :::
 *
 * This component is returned by the `addTask` method of the `Cluster` component.
 */
export class Task extends Component implements Link.Linkable {
  private readonly _cluster: Cluster;
  private readonly vpc: {
    isSstVpc: boolean;
    containerSubnets: Output<Output<string>[]>;
    securityGroups: Output<Output<string>[]>;
  };
  private readonly executionRole: iam.Role;
  private readonly taskRole: iam.Role;
  private readonly _taskDefinition: Output<ecs.TaskDefinition>;
  private readonly containerNames: Output<Output<string>[]>;
  private readonly dev: boolean;

  constructor(
    name: string,
    args: TaskArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const dev = normalizeDev();
    if (dev) {
      args.image = "ghcr.io/sst/sst/bridge-task:20241224005724";
      args.environment = $resolve({
        environment: args.environment,
      }).apply(async (input) => {
        const appsync = await Function.appsync();
        const env = input.environment ?? {};
        env.SST_TASK_ID = name;
        env.SST_REGION = process.env.SST_AWS_REGION!;
        env.SST_APPSYNC_HTTP = appsync.http;
        env.SST_APPSYNC_REALTIME = appsync.realtime;
        env.SST_APP = $app.name;
        env.SST_STAGE = $app.stage;
        return env;
      });
      args.permissions = $resolve({ permissions: args.permissions }).apply(
        (input) => {
          const permissions = input.permissions ?? [];
          permissions.push({
            actions: ["appsync:*"],
            resources: ["*"],
          });
          return permissions;
        },
      );
    }
    const architecture = normalizeArchitecture(args);
    const cpu = normalizeCpu(args);
    const memory = normalizeMemory(cpu, args);
    const storage = normalizeStorage(args);
    const containers = normalizeContainers("task", args, name, architecture);
    const vpc = normalizeVpc();

    const taskRole = createTaskRole(name, args, opts, self);
    this.dev = dev;
    this.taskRole = taskRole;

    const executionRole = createExecutionRole(name, args, opts, self);
    const taskDefinition = createTaskDefinition(
      name,
      args,
      opts,
      self,
      containers,
      architecture,
      cpu,
      memory,
      storage,
      taskRole,
      executionRole,
    );

    this._cluster = args.cluster;
    this.vpc = vpc;
    this.executionRole = executionRole;
    this._taskDefinition = taskDefinition;
    this.containerNames = containers.apply((v) => v.map((v) => output(v.name)));
    this.registerOutputs({
      _task: all([args.dev, containers]).apply(([v, containers]) => ({
        directory: (() => {
          if (!containers[0].image) return "";
          if (typeof containers[0].image === "string") return "";
          if (containers[0].image.context) return containers[0].image.context;
          return "";
        })(),
        ...v,
      })),
    });

    function normalizeDev() {
      if (!$dev) return false;
      if (args.dev === false) return false;
      return true;
    }

    function normalizeVpc() {
      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        const vpc = args.vpc;
        return {
          isSstVpc: true,
          containerSubnets: vpc.publicSubnets,
          securityGroups: vpc.securityGroups,
        };
      }

      // "vpc" is object
      return {
        isSstVpc: false,
        containerSubnets: output(args.vpc).apply((v) =>
          v.containerSubnets.map((v) => output(v)),
        ),
        securityGroups: output(args.vpc).apply((v) =>
          v.securityGroups.map((v) => output(v)),
        ),
      };
    }
  }

  /**
   * The ARN of the ECS Task Definition.
   */
  public get taskDefinition() {
    return this._taskDefinition.arn;
  }

  /**
   * The names of the containers in the task.
   * @internal
   */
  public get containers() {
    return this.containerNames;
  }

  /**
   * The ARN of the cluster this task is deployed to.
   * @internal
   */
  public get cluster() {
    return this._cluster.nodes.cluster.arn;
  }

  /**
   * The security groups for the task.
   * @internal
   */
  public get securityGroups() {
    return this.vpc.securityGroups;
  }

  /**
   * The subnets for the task.
   * @internal
   */
  public get subnets() {
    return this.vpc.containerSubnets;
  }

  /**
   * Whether to assign a public IP address to the task.
   * @internal
   */
  public get assignPublicIp() {
    return this.vpc.isSstVpc;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon ECS Execution Role.
       */
      executionRole: this.executionRole,
      /**
       * The Amazon ECS Task Role.
       */
      taskRole: this.taskRole,
      /**
       * The Amazon ECS Task Definition.
       */
      taskDefinition: this._taskDefinition,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        cluster: this.cluster,
        containers: this.containers,
        taskDefinition: this.taskDefinition,
        subnets: this.subnets,
        securityGroups: this.securityGroups,
        assignPublicIp: this.assignPublicIp,
      },
      include: [
        permission({
          actions: ["ecs:*"],
          resources: [
            this._taskDefinition.arn,
            // permissions to describe and stop the task
            this.cluster.apply(
              (v) => v.split(":cluster/").join(":task/") + "/*",
            ),
          ],
        }),
        permission({
          actions: ["iam:PassRole"],
          resources: [this.executionRole.arn, this.taskRole.arn],
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:Task";
// @ts-expect-error
Task.__pulumiType = __pulumiType;
