import fs from "fs";
import path from "path";
import {
  ComponentResourceOptions,
  Input,
  Output,
  all,
  interpolate,
  output,
  secret,
} from "@pulumi/pulumi";
import { Image, Platform } from "@pulumi/docker-build";
import { Component, transform } from "../component.js";
import { toGBs, toMBs } from "../size.js";
import { toNumber } from "../cpu.js";
import { dns as awsDns } from "./dns.js";
import { VisibleError } from "../error.js";
import { DnsValidatedCertificate } from "./dns-validated-certificate.js";
import { Link } from "../link.js";
import { bootstrap } from "./helpers/bootstrap.js";
import {
  ClusterArgs,
  ClusterServiceArgs,
  supportedCpus,
  supportedMemories,
} from "./cluster.js";
import { RETENTION } from "./logging.js";
import { URL_UNAVAILABLE } from "./linkable.js";
import {
  appautoscaling,
  cloudwatch,
  ec2,
  ecr,
  ecs,
  getCallerIdentityOutput,
  getRegionOutput,
  iam,
  lb,
  servicediscovery,
} from "@pulumi/aws";
import { Permission } from "./permission.js";
import { Vpc } from "./vpc.js";
import { Vpc as VpcV1 } from "./vpc-v1";
import { DevCommand } from "../experimental/dev-command.js";
import { Efs } from "./efs.js";
import { toSeconds } from "../duration.js";

export interface ServiceArgs extends ClusterServiceArgs {
  /**
   * The cluster to use for the service.
   */
  cluster: Input<{
    /**
     * The name of the cluster.
     */
    name: Input<string>;
    /**
     * The ARN of the cluster.
     */
    arn: Input<string>;
  }>;
  /**
   * The VPC to use for the cluster.
   */
  vpc: ClusterArgs["vpc"];
}

/**
 * The `Service` component is internally used by the `Cluster` component to deploy services to
 * [Amazon ECS](https://aws.amazon.com/ecs/). It uses [AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).
 *
 * :::note
 * This component is not meant to be created directly.
 * :::
 *
 * This component is returned by the `addService` method of the `Cluster` component.
 */
export class Service extends Component implements Link.Linkable {
  private readonly _service?: ecs.Service;
  private readonly cloudmapNamespace?: Output<string>;
  private readonly cloudmapService?: servicediscovery.Service;
  private readonly executionRole?: iam.Role;
  private readonly taskRole: iam.Role;
  private readonly taskDefinition?: Output<ecs.TaskDefinition>;
  private readonly loadBalancer?: lb.LoadBalancer;
  private readonly domain?: Output<string | undefined>;
  private readonly _url?: Output<string>;
  private readonly devUrl?: Output<string>;
  private readonly dev: boolean;

  constructor(
    name: string,
    args: ServiceArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const dev = normalizeDev();
    const cluster = output(args.cluster);
    const region = normalizeRegion();
    const architecture = normalizeArchitecture();
    const cpu = normalizeCpu();
    const memory = normalizeMemory();
    const storage = normalizeStorage();
    const scaling = normalizeScaling();
    const containers = normalizeContainers();
    const lbArgs = normalizeLoadBalancer();
    const { isSstVpc, vpc } = normalizeVpc();

    const taskRole = createTaskRole();

    this.dev = !!dev;
    this.cloudmapNamespace = vpc.cloudmapNamespaceName;
    this.taskRole = taskRole;

    if (dev) {
      this.devUrl = !lbArgs ? undefined : dev.url;
      registerReceiver();
      return;
    }

    const bootstrapData = region.apply((region) => bootstrap.forRegion(region));
    const executionRole = createExecutionRole();
    const taskDefinition = createTaskDefinition();
    const certificateArn = createSsl();
    const { loadBalancer, targets } = createLoadBalancer();
    const cloudmapService = createCloudmapService();
    const service = createService();
    createAutoScaling();
    createDnsRecords();

    this._service = service;
    this.cloudmapService = cloudmapService;
    this.executionRole = executionRole;
    this.taskDefinition = taskDefinition;
    this.loadBalancer = loadBalancer;
    this.domain = lbArgs?.domain
      ? lbArgs.domain.apply((domain) => domain?.name)
      : output(undefined);
    this._url = !self.loadBalancer
      ? undefined
      : all([self.domain, self.loadBalancer?.dnsName]).apply(
          ([domain, loadBalancer]) =>
            domain ? `https://${domain}/` : `http://${loadBalancer}`,
        );

    this.registerOutputs({ _hint: this._url });
    registerReceiver();

    function normalizeDev() {
      if (!$dev) return undefined;
      if (args.dev === false) return undefined;

      return {
        url: output(args.dev?.url ?? URL_UNAVAILABLE),
      };
    }

    function normalizeVpc() {
      // "vpc" is a Vpc.v1 component
      if (args.vpc instanceof VpcV1) {
        throw new VisibleError(
          `You are using the "Vpc.v1" component. Please migrate to the latest "Vpc" component.`,
        );
      }

      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        const vpc = args.vpc;
        return {
          isSstVpc: true,
          vpc: {
            id: vpc.id,
            loadBalancerSubnets: lbArgs?.pub.apply((v) =>
              v ? vpc.publicSubnets : vpc.privateSubnets,
            ),
            serviceSubnets: vpc.publicSubnets,
            securityGroups: vpc.securityGroups,
            cloudmapNamespaceId: vpc.nodes.cloudmapNamespace.id,
            cloudmapNamespaceName: vpc.nodes.cloudmapNamespace.name,
          },
        };
      }

      // "vpc" is object
      return { vpc: output(args.vpc) };
    }

    function normalizeRegion() {
      return getRegionOutput(undefined, { parent: self }).name;
    }

    function normalizeArchitecture() {
      return output(args.architecture ?? "x86_64").apply((v) => v);
    }

    function normalizeCpu() {
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

    function normalizeMemory() {
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

    function normalizeStorage() {
      return output(args.storage ?? "20 GB").apply((v) => {
        const storage = toGBs(v);
        if (storage < 20 || storage > 200)
          throw new Error(
            `Unsupported storage: ${v}. The supported value for storage is between "20 GB" and "200 GB"`,
          );
        return v;
      });
    }

    function normalizeScaling() {
      return output(args.scaling).apply((v) => ({
        min: v?.min ?? 1,
        max: v?.max ?? 1,
        cpuUtilization: v?.cpuUtilization ?? 70,
        memoryUtilization: v?.memoryUtilization ?? 70,
      }));
    }

    function normalizeContainers() {
      if (
        args.containers &&
        (args.image || args.logging || args.environment || args.volumes)
      ) {
        throw new VisibleError(
          `You cannot provide both "containers" and "image", "logging", "environment" or "volumes".`,
        );
      }

      // Standardize containers
      const containers = args.containers ?? [
        {
          name: name,
          image: args.image,
          logging: args.logging,
          environment: args.environment,
          volumes: args.volumes,
          command: args.command,
          entrypoint: args.entrypoint,
          dev: args.dev,
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
            return all([v.image, architecture]).apply(
              ([image, architecture]) => {
                if (typeof image === "string") return image;

                return {
                  ...image,
                  context: image?.context ?? ".",
                  platform:
                    architecture === "arm64"
                      ? Platform.Linux_arm64
                      : Platform.Linux_amd64,
                };
              },
            );
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

    function normalizeLoadBalancer() {
      if (!args.loadBalancer && !args.public) return;

      if (args.loadBalancer && args.public)
        throw new VisibleError(
          `You cannot provide both "loadBalancer" and "public". "public" is deprecated. Use "loadBalancer" to configure the load balancer.`,
        );

      // normalize ports
      const ports = all([
        (args.loadBalancer ?? args.public)!,
        containers,
      ]).apply(([lb, containers]) => {
        // validate ports
        if (!lb.ports || lb.ports.length === 0)
          throw new VisibleError(
            `You must provide the ports to expose via "loadBalancer.ports".`,
          );

        // validate container defined when multiple containers exists
        if (containers.length > 1) {
          lb.ports.forEach((v) => {
            if (!v.container)
              throw new VisibleError(
                `You must provide a container name in "loadBalancer.ports" when there is more than one container.`,
              );
          });
        }

        // parse protocols and ports
        const ports = lb.ports.map((v) => {
          const listenParts = v.listen.split("/");
          const forwardParts = v.forward ? v.forward.split("/") : listenParts;
          return {
            listenPort: parseInt(listenParts[0]),
            listenProtocol: listenParts[1],
            forwardPort: parseInt(forwardParts[0]),
            forwardProtocol: forwardParts[1],
            container: v.container ?? containers[0].name,
          };
        });

        // validate protocols are consistent
        const appProtocols = ports.filter(
          (port) =>
            ["http", "https"].includes(port.listenProtocol) &&
            ["http", "https"].includes(port.forwardProtocol),
        );
        if (appProtocols.length > 0 && appProtocols.length < ports.length)
          throw new VisibleError(
            `Protocols must be either all http/https, or all tcp/udp/tcp_udp/tls.`,
          );

        // validate certificate exists for https/tls protocol
        ports.forEach((port) => {
          if (["https", "tls"].includes(port.listenProtocol) && !lb.domain) {
            throw new VisibleError(
              `You must provide a custom domain for ${port.listenProtocol.toUpperCase()} protocol.`,
            );
          }
        });

        return ports;
      });

      // normalize domain
      const domain = output((args.loadBalancer ?? args.public)!).apply((lb) => {
        if (!lb.domain) return undefined;

        // normalize domain
        const domain =
          typeof lb.domain === "string" ? { name: lb.domain } : lb.domain;
        return {
          name: domain.name,
          dns: domain.dns === false ? undefined : domain.dns ?? awsDns(),
          cert: domain.cert,
        };
      });

      // normalize type
      const type = output(ports).apply((ports) =>
        ports[0].listenProtocol.startsWith("http") ? "application" : "network",
      );

      // normalize public/private
      const pub = output(args.loadBalancer).apply((lb) => lb?.public ?? true);

      // normalize health check
      const health = all([type, ports, args.loadBalancer]).apply(
        ([type, ports, lb]) =>
          Object.fromEntries(
            Object.entries(lb?.health ?? {}).map(([k, v]) => {
              if (
                !ports.find(
                  (p) => `${p.forwardPort}/${p.forwardProtocol}` === k,
                )
              )
                throw new VisibleError(
                  `Cannot configure health check for "${k}". Make sure it is defined in "loadBalancer.ports".`,
                );
              return [
                k,
                {
                  path: v.path ?? "/",
                  interval: v.interval ? toSeconds(v.interval) : 30,
                  timeout: v.timeout
                    ? toSeconds(v.timeout)
                    : type === "application"
                      ? 5
                      : 6,
                  healthyThreshold: v.healthyThreshold ?? 5,
                  unhealthyThreshold: v.unhealthyThreshold ?? 2,
                  matcher: v.successCodes ?? "200",
                },
              ];
            }),
          ),
      );

      return { type, ports, domain, pub, health };
    }

    function createLoadBalancer() {
      if (!lbArgs) return {};

      const securityGroup = new ec2.SecurityGroup(
        ...transform(
          args?.transform?.loadBalancerSecurityGroup,
          `${name}LoadBalancerSecurityGroup`,
          {
            vpcId: vpc.id,
            egress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
            ingress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
          },
          { parent: self },
        ),
      );

      const loadBalancer = new lb.LoadBalancer(
        ...transform(
          args.transform?.loadBalancer,
          `${name}LoadBalancer`,
          {
            internal: lbArgs.pub.apply((v) => !v),
            loadBalancerType: lbArgs.type,
            subnets: vpc.loadBalancerSubnets,
            securityGroups: [securityGroup.id],
            enableCrossZoneLoadBalancing: true,
          },
          { parent: self },
        ),
      );

      const ret = all([lbArgs.ports, lbArgs.health, certificateArn]).apply(
        ([ports, health, cert]) => {
          const listeners: Record<string, lb.Listener> = {};
          const targets: Record<string, lb.TargetGroup> = {};

          ports.forEach((p) => {
            const container = p.container;
            const forwardProtocol = p.forwardProtocol.toUpperCase();
            const forwardPort = p.forwardPort;
            const targetId = `${container}${forwardProtocol}${forwardPort}`;
            const target =
              targets[targetId] ??
              new lb.TargetGroup(
                ...transform(
                  args.transform?.target,
                  `${name}Target${targetId}`,
                  {
                    // TargetGroup names allow for 32 chars, but an 8 letter suffix
                    // ie. "-1234567" is automatically added.
                    // - If we don't specify "name" or "namePrefix", we need to ensure
                    //   the component name is less than 24 chars. Hard to guarantee.
                    // - If we specify "name", we need to ensure the $app-$stage-$name
                    //   if less than 32 chars. Hard to guarantee.
                    // - Hence we will use "namePrefix".
                    namePrefix: forwardProtocol,
                    port: forwardPort,
                    protocol: forwardProtocol,
                    targetType: "ip",
                    vpcId: vpc.id,
                    healthCheck:
                      health[`${p.forwardPort}/${p.forwardProtocol}`],
                  },
                  { parent: self },
                ),
              );
            targets[targetId] = target;

            const listenProtocol = p.listenProtocol.toUpperCase();
            const listenPort = p.listenPort;
            const listenerId = `${listenProtocol}${listenPort}`;
            const listener =
              listeners[listenerId] ??
              new lb.Listener(
                ...transform(
                  args.transform?.listener,
                  `${name}Listener${listenerId}`,
                  {
                    loadBalancerArn: loadBalancer.arn,
                    port: listenPort,
                    protocol: listenProtocol,
                    certificateArn: ["HTTPS", "TLS"].includes(listenProtocol)
                      ? cert
                      : undefined,
                    defaultActions: [
                      {
                        type: "forward",
                        targetGroupArn: target.arn,
                      },
                    ],
                  },
                  { parent: self },
                ),
              );
            listeners[listenerId] = listener;
          });

          return { listeners, targets };
        },
      );

      return { loadBalancer, targets: ret.targets };
    }

    function createSsl() {
      if (!lbArgs) return output(undefined);

      return lbArgs.domain.apply((domain) => {
        if (!domain) return output(undefined);
        if (domain.cert) return output(domain.cert);

        return new DnsValidatedCertificate(
          `${name}Ssl`,
          {
            domainName: domain.name,
            dns: domain.dns!,
          },
          { parent: self },
        ).arn;
      });
    }

    function createTaskRole() {
      if (args.taskRole)
        return iam.Role.get(
          `${name}TaskRole`,
          args.taskRole,
          {},
          { parent: self },
        );

      const policy = all([
        args.permissions || [],
        Link.getInclude<Permission>("aws.permission", args.link),
      ]).apply(([argsPermissions, linkPermissions]) =>
        iam.getPolicyDocumentOutput({
          statements: [
            ...argsPermissions,
            ...linkPermissions.map((item) => ({
              actions: item.actions,
              resources: item.resources,
            })),
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
            assumeRolePolicy: !dev
              ? iam.assumeRolePolicyForPrincipal({
                  Service: "ecs-tasks.amazonaws.com",
                })
              : iam.assumeRolePolicyForPrincipal({
                  AWS: interpolate`arn:aws:iam::${
                    getCallerIdentityOutput().accountId
                  }:root`,
                }),
            inlinePolicies: policy.apply(({ statements }) =>
              statements ? [{ name: "inline", policy: policy.json }] : [],
            ),
          },
          { parent: self },
        ),
      );
    }

    function createExecutionRole() {
      if (args.executionRole)
        return iam.Role.get(
          `${name}ExecutionRole`,
          args.executionRole,
          {},
          { parent: self },
        );

      return new iam.Role(
        ...transform(
          args.transform?.executionRole,
          `${name}ExecutionRole`,
          {
            assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
              Service: "ecs-tasks.amazonaws.com",
            }),
            managedPolicyArns: [
              "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
            ],
          },
          { parent: self },
        ),
      );
    }

    function createTaskDefinition() {
      const containerDefinitions = all([
        containers,
        Link.propertiesToEnv(Link.getProperties(args.link)),
      ]).apply(([containers, linkEnvs]) =>
        containers.map((container) => ({
          name: container.name,
          image: (() => {
            if (typeof container.image === "string")
              return output(container.image);

            const contextPath = path.join(
              $cli.paths.root,
              container.image.context,
            );
            const dockerfile = container.image.dockerfile ?? "Dockerfile";
            const dockerfilePath = container.image.dockerfile
              ? path.join($cli.paths.root, container.image.dockerfile)
              : path.join(
                  $cli.paths.root,
                  container.image.context,
                  "Dockerfile",
                );
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
            const image = new Image(
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
                  platforms: [container.image.platform],
                  tags: [
                    interpolate`${bootstrapData.assetEcrUrl}:${container.name}`,
                  ],
                  registries: [
                    ecr
                      .getAuthorizationTokenOutput(
                        {
                          registryId: bootstrapData.assetEcrRegistryId,
                        },
                        { parent: self },
                      )
                      .apply((authToken) => ({
                        address: authToken.proxyEndpoint,
                        password: secret(authToken.password),
                        username: authToken.userName,
                      })),
                  ],
                  push: true,
                },
                { parent: self },
              ),
            );

            return interpolate`${bootstrapData.assetEcrUrl}@${image.digest}`;
          })(),
          command: container.command,
          entrypoint: container.entrypoint,
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
                      name: interpolate`/sst/cluster/${cluster.name}/${name}/${container.name}`,
                      retentionInDays: RETENTION[container.logging.retention],
                    },
                    { parent: self },
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
        })),
      );

      return storage.apply(
        (storage) =>
          new ecs.TaskDefinition(
            ...transform(
              args.transform?.taskDefinition,
              `${name}Task`,
              {
                family: interpolate`${cluster.name}-${name}`,
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
                      if (uniqueAccessPoints.has(volume.efs.accessPoint))
                        return [];
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
              { parent: self },
            ),
          ),
      );
    }

    function createCloudmapService() {
      return new servicediscovery.Service(
        `${name}CloudmapService`,
        {
          name: `${name}.${$app.stage}.${$app.name}`,
          namespaceId: vpc.cloudmapNamespaceId,
          forceDestroy: true,
          dnsConfig: {
            namespaceId: vpc.cloudmapNamespaceId,
            dnsRecords: [
              ...(args.serviceRegistry ? [{ ttl: 60, type: "SRV" }] : []),
              { ttl: 60, type: "A" },
            ],
          },
        },
        { parent: self },
      );
    }

    function createService() {
      return new ecs.Service(
        ...transform(
          args.transform?.service,
          `${name}Service`,
          {
            name,
            cluster: cluster.arn,
            taskDefinition: taskDefinition.arn,
            desiredCount: scaling.min,
            launchType: "FARGATE",
            networkConfiguration: {
              // If the vpc is an SST vpc, services are automatically deployed to the public
              // subnets. So we need to assign a public IP for the service to be accessible.
              assignPublicIp: isSstVpc,
              subnets: vpc.serviceSubnets,
              securityGroups: vpc.securityGroups,
            },
            deploymentCircuitBreaker: {
              enable: true,
              rollback: true,
            },

            loadBalancers:
              lbArgs &&
              all([lbArgs.ports, targets!]).apply(([ports, targets]) =>
                Object.values(targets).map((target) => ({
                  targetGroupArn: target.arn,
                  containerName: target.port.apply(
                    (port) =>
                      ports.find((p) => p.forwardPort === port)!.container,
                  ),
                  containerPort: target.port.apply((port) => port!),
                })),
              ),
            enableExecuteCommand: true,
            serviceRegistries: {
              registryArn: cloudmapService.arn,
              port: args.serviceRegistry
                ? output(args.serviceRegistry).port
                : undefined,
            },
          },
          { parent: self },
        ),
      );
    }

    function createAutoScaling() {
      const target = new appautoscaling.Target(
        `${name}AutoScalingTarget`,
        {
          serviceNamespace: "ecs",
          scalableDimension: "ecs:service:DesiredCount",
          resourceId: interpolate`service/${cluster.name}/${service.name}`,
          maxCapacity: scaling.max,
          minCapacity: scaling.min,
        },
        { parent: self },
      );

      new appautoscaling.Policy(
        `${name}AutoScalingCpuPolicy`,
        {
          serviceNamespace: target.serviceNamespace,
          scalableDimension: target.scalableDimension,
          resourceId: target.resourceId,
          policyType: "TargetTrackingScaling",
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: "ECSServiceAverageCPUUtilization",
            },
            targetValue: scaling.cpuUtilization,
          },
        },
        { parent: self },
      );

      new appautoscaling.Policy(
        `${name}AutoScalingMemoryPolicy`,
        {
          serviceNamespace: target.serviceNamespace,
          scalableDimension: target.scalableDimension,
          resourceId: target.resourceId,
          policyType: "TargetTrackingScaling",
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: "ECSServiceAverageMemoryUtilization",
            },
            targetValue: scaling.memoryUtilization,
          },
        },
        { parent: self },
      );
    }

    function createDnsRecords() {
      if (!lbArgs) return;

      lbArgs.domain.apply((domain) => {
        if (!domain?.dns) return;

        domain.dns.createAlias(
          name,
          {
            name: domain.name,
            aliasName: loadBalancer!.dnsName,
            aliasZone: loadBalancer!.zoneId,
          },
          { parent: self },
        );
      });
    }

    function registerReceiver() {
      containers.apply((val) => {
        for (const container of val) {
          const title = val.length == 1 ? name : `${name}${container.name}`;
          new DevCommand(`${title}Dev`, {
            link: args.link,
            dev: {
              title,
              autostart: true,
              directory: output(args.image).apply((image) => {
                if (!image) return "";
                if (typeof image === "string") return "";
                if (image.context) return path.dirname(image.context);
                return "";
              }),
              ...container.dev,
            },
            environment: {
              ...container.environment,
              AWS_REGION: region,
            },
            aws: {
              role: taskRole.arn,
            },
          });
        }
      });
    }
  }

  /**
   * The URL of the service.
   *
   * If `public.domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the autogenerated load balancer URL.
   */
  public get url() {
    const errorMessage =
      "Cannot access the URL because no public ports are exposed.";
    if (this.dev) {
      if (!this.devUrl) throw new VisibleError(errorMessage);
      return this.devUrl;
    }

    if (!this._url) throw new VisibleError(errorMessage);
    return this._url;
  }

  /**
   * The name of the Cloud Map service.
   */
  public get service() {
    return this.dev
      ? interpolate`dev.${this.cloudmapNamespace}`
      : interpolate`${this.cloudmapService!.name}.${this.cloudmapNamespace}`;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Amazon ECS Service.
       */
      get service() {
        if (self.dev)
          throw new VisibleError("Cannot access `nodes.service` in dev mode.");
        return self._service!;
      },
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
      get taskDefinition() {
        if (self.dev)
          throw new VisibleError(
            "Cannot access `nodes.taskDefinition` in dev mode.",
          );
        return self.taskDefinition!;
      },
      /**
       * The Amazon Elastic Load Balancer.
       */
      get loadBalancer() {
        if (self.dev)
          throw new VisibleError(
            "Cannot access `nodes.loadBalancer` in dev mode.",
          );
        if (!self.loadBalancer)
          throw new VisibleError(
            "Cannot access `nodes.loadBalancer` when no public ports are exposed.",
          );
        return self.loadBalancer;
      },
      /**
       * The Amazon Cloud Map service.
       */
      get cloudmapService() {
        if (self.dev)
          throw new VisibleError(
            "Cannot access `nodes.cloudmapService` in dev mode.",
          );
        return self.cloudmapService!;
      },
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: this.dev ? this.devUrl : this._url,
        service: this.service,
      },
    };
  }
}

const __pulumiType = "sst:aws:Service";
// @ts-expect-error
Service.__pulumiType = __pulumiType;
