import {
  ComponentResource,
  ComponentResourceOptions,
  Inputs,
  runtime,
  output,
  asset as pulumiAsset,
  Input,
  all,
} from "@pulumi/pulumi";
import { physicalName } from "./naming.js";
import { VisibleError } from "./error.js";
import { getRegionOutput } from "@pulumi/aws";
import path from "path";
import { statSync } from "fs";

// Previously, `this.api.id` was used as the ID. `this.api.id` was of type Output<string>
// the value evaluates to the mistake id.
// In the future version, we will release a breaking change to fix this.
export const outputId =
  "Calling [toString] on an [Output<T>] is not supported.\n\nTo get the value of an Output<T> as an Output<string> consider either:\n1: o.apply(v => `prefix${v}suffix`)\n2: pulumi.interpolate `prefix${v}suffix`\n\nSee https://www.pulumi.com/docs/concepts/inputs-outputs for more details.\nThis function may throw in a future version of @pulumi/pulumi.";

/**
 * Helper type to inline nested types
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type Transform<T> =
  | Partial<T>
  | ((args: T, opts: $util.CustomResourceOptions, name: string) => undefined);

export function transform<T extends object>(
  transform: Transform<T> | undefined,
  name: string,
  args: T,
  opts: $util.CustomResourceOptions,
) {
  // Case: transform is a function
  if (typeof transform === "function") {
    transform(args, opts, name);
    return [name, args, opts] as const;
  }

  // Case: no transform
  // Case: transform is an argument
  return [name, { ...args, ...transform }, opts] as const;
}

export class Component extends ComponentResource {
  constructor(
    type: string,
    name: string,
    args?: Inputs,
    opts?: ComponentResourceOptions,
    _versionInfo: {
      _version: number;
      _message: string;
      _forceUpgrade?: `v${number}`;
    } = { _version: 1, _message: "" },
  ) {
    const transforms = ComponentTransforms.get(type) ?? [];
    for (const transform of transforms) {
      transform({ props: args, opts });
    }
    super(type, name, args, {
      transformations: [
        // Ensure logical and physical names are prefixed
        (args) => {
          // Ensure names are prefixed with parent's name
          if (
            args.type !== type &&
            // @ts-expect-error
            !args.name.startsWith(args.opts.parent!.__name)
          ) {
            throw new Error(
              `In "${name}" component, the logical name of "${args.name}" (${
                args.type
              }) is not prefixed with parent's name ${
                // @ts-expect-error
                args.opts.parent!.__name
              }`,
            );
          }

          // Ensure physical names are prefixed with app/stage
          // note: We are setting the default names here instead of inline when creating
          //       the resource is b/c the physical name is inferred from the logical name.
          //       And it's convenient to access the logical name here.
          if (
            args.type.startsWith("sst:") ||
            args.type === "pulumi-nodejs:dynamic:Resource" ||
            args.type === "random:index/randomId:RandomId" ||
            args.type === "random:index/randomPassword:RandomPassword" ||
            args.type === "tls:index/privateKey:PrivateKey" ||
            // resources manually named
            [
              "aws:appsync/dataSource:DataSource",
              "aws:appsync/function:Function",
              "aws:appsync/resolver:Resolver",
              "aws:cloudwatch/eventBus:EventBus",
              "aws:cognito/identityPool:IdentityPool",
              "aws:ecs/service:Service",
              "aws:ecs/taskDefinition:TaskDefinition",
              "aws:lb/targetGroup:TargetGroup",
              "aws:s3/bucketV2:BucketV2",
              "aws:servicediscovery/privateDnsNamespace:PrivateDnsNamespace",
              "aws:servicediscovery/service:Service",
              "aws:sesv2/configurationSet:ConfigurationSet",
            ].includes(args.type) ||
            // resources not prefixed
            [
              "aws:acm/certificate:Certificate",
              "aws:acm/certificateValidation:CertificateValidation",
              "aws:apigateway/basePathMapping:BasePathMapping",
              "aws:apigateway/deployment:Deployment",
              "aws:apigateway/domainName:DomainName",
              "aws:apigateway/integration:Integration",
              "aws:apigateway/integrationResponse:IntegrationResponse",
              "aws:apigateway/method:Method",
              "aws:apigateway/methodResponse:MethodResponse",
              "aws:apigateway/resource:Resource",
              "aws:apigateway/response:Response",
              "aws:apigateway/stage:Stage",
              "aws:apigatewayv2/apiMapping:ApiMapping",
              "aws:apigatewayv2/domainName:DomainName",
              "aws:apigatewayv2/integration:Integration",
              "aws:apigatewayv2/route:Route",
              "aws:apigatewayv2/stage:Stage",
              "aws:appautoscaling/target:Target",
              "aws:appsync/domainName:DomainName",
              "aws:appsync/domainNameApiAssociation:DomainNameApiAssociation",
              "aws:ec2/routeTableAssociation:RouteTableAssociation",
              "aws:efs/fileSystem:FileSystem",
              "aws:efs/mountTarget:MountTarget",
              "aws:efs/accessPoint:AccessPoint",
              "aws:iam/accessKey:AccessKey",
              "aws:iam/instanceProfile:InstanceProfile",
              "aws:iam/policy:Policy",
              "aws:iam/userPolicy:UserPolicy",
              "aws:cloudfront/cachePolicy:CachePolicy",
              "aws:cloudfront/distribution:Distribution",
              "aws:cloudwatch/eventRule:EventRule",
              "aws:cloudwatch/eventTarget:EventTarget",
              "aws:cloudwatch/logGroup:LogGroup",
              "aws:cognito/identityPoolRoleAttachment:IdentityPoolRoleAttachment",
              "aws:cognito/identityProvider:IdentityProvider",
              "aws:cognito/userPoolClient:UserPoolClient",
              "aws:elasticache/replicationGroup:ReplicationGroup",
              "aws:lambda/eventSourceMapping:EventSourceMapping",
              "aws:lambda/functionUrl:FunctionUrl",
              "aws:lambda/invocation:Invocation",
              "aws:lambda/permission:Permission",
              "aws:lambda/provisionedConcurrencyConfig:ProvisionedConcurrencyConfig",
              "aws:lb/listener:Listener",
              "aws:rds/proxyDefaultTargetGroup:ProxyDefaultTargetGroup",
              "aws:rds/proxyTarget:ProxyTarget",
              "aws:route53/record:Record",
              "aws:s3/bucketCorsConfigurationV2:BucketCorsConfigurationV2",
              "aws:s3/bucketNotification:BucketNotification",
              "aws:s3/bucketObject:BucketObject",
              "aws:s3/bucketObjectv2:BucketObjectv2",
              "aws:s3/bucketPolicy:BucketPolicy",
              "aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock",
              "aws:s3/bucketVersioningV2:BucketVersioningV2",
              "aws:s3/bucketWebsiteConfigurationV2:BucketWebsiteConfigurationV2",
              "aws:secretsmanager/secretVersion:SecretVersion",
              "aws:ses/domainIdentityVerification:DomainIdentityVerification",
              "aws:sesv2/configurationSetEventDestination:ConfigurationSetEventDestination",
              "aws:sesv2/emailIdentity:EmailIdentity",
              "aws:sns/topicSubscription:TopicSubscription",
              "aws:sqs/queuePolicy:QueuePolicy",
              "cloudflare:index/record:Record",
              "cloudflare:index/workerDomain:WorkerDomain",
              "docker-build:index:Image",
              "vercel:index/dnsRecord:DnsRecord",
              "cloudflare:index/workerCronTrigger:WorkerCronTrigger",
            ].includes(args.type)
          )
            return;

          const namingRules = [
            {
              // AWS LoadBalancer resource names allow for 32 chars, but an 8 letter suffix
              // ie. "-1234567" is automatically added
              types: ["aws:lb/loadBalancer:LoadBalancer"],
              field: "name",
              cb: () => physicalName(24, args.name),
            },
            {
              types: ["aws:rds/proxy:Proxy"],
              field: "name",
              cb: () => physicalName(60, args.name).toLowerCase(),
            },
            {
              types: ["aws:rds/cluster:Cluster"],
              field: "clusterIdentifier",
              cb: () => physicalName(63, args.name).toLowerCase(),
            },
            {
              types: [
                "aws:rds/clusterInstance:ClusterInstance",
                "aws:rds/instance:Instance",
              ],
              field: "identifier",
              cb: () => physicalName(63, args.name).toLowerCase(),
            },
            {
              types: [
                "aws:cloudwatch/eventRule:EventRule",
                "aws:cloudfront/function:Function",
                "aws:iam/user:User",
                "aws:lambda/function:Function",
              ],
              field: "name",
              cb: () => physicalName(64, args.name),
            },
            {
              types: ["aws:sqs/queue:Queue"],
              field: "name",
              cb: () =>
                output(args.props.fifoQueue).apply((fifo) =>
                  physicalName(80, args.name, fifo ? ".fifo" : undefined),
                ),
            },
            {
              types: ["aws:iam/role:Role"],
              field: "name",
              cb: () =>
                getRegionOutput(undefined, {
                  parent: args.opts.parent,
                  provider: args.opts.provider,
                }).name.apply((region) =>
                  physicalName(
                    64,
                    args.name,
                    `-${region.toLowerCase().replace(/-/g, "")}`,
                  ),
                ),
            },
            {
              types: [
                "aws:apigateway/authorizer:Authorizer",
                "aws:apigateway/restApi:RestApi",
                "aws:apigatewayv2/api:Api",
                "aws:apigatewayv2/authorizer:Authorizer",
                "aws:apigatewayv2/vpcLink:VpcLink",
                "aws:cognito/userPool:UserPool",
                "aws:iot/authorizer:Authorizer",
              ],
              field: "name",
              cb: () => physicalName(128, args.name),
            },
            {
              types: ["aws:iot/topicRule:TopicRule"],
              field: "name",
              cb: () => physicalName(128, args.name).replaceAll("-", "_"),
            },
            {
              types: [
                "aws:appautoscaling/policy:Policy",
                "aws:dynamodb/table:Table",
                "aws:kinesis/stream:Stream",
                "aws:ecs/cluster:Cluster",
              ],
              field: "name",
              cb: () => physicalName(255, args.name),
            },
            {
              types: [
                "aws:elasticache/subnetGroup:SubnetGroup",
                "aws:rds/parameterGroup:ParameterGroup",
                "aws:rds/subnetGroup:SubnetGroup",
              ],
              field: "name",
              cb: () => physicalName(255, args.name).toLowerCase(),
            },
            {
              types: ["aws:ec2/keyPair:KeyPair"],
              field: "keyName",
              cb: () => physicalName(255, args.name),
            },
            {
              types: [
                "aws:ec2/eip:Eip",
                "aws:ec2/instance:Instance",
                "aws:ec2/internetGateway:InternetGateway",
                "aws:ec2/natGateway:NatGateway",
                "aws:ec2/routeTable:RouteTable",
                "aws:ec2/securityGroup:SecurityGroup",
                "aws:ec2/defaultSecurityGroup:DefaultSecurityGroup",
                "aws:ec2/subnet:Subnet",
                "aws:ec2/vpc:Vpc",
              ],
              field: "tags",
              cb: () => ({
                // @ts-expect-error
                ...args.tags,
                Name: physicalName(255, args.name),
              }),
            },
            {
              types: ["aws:sns/topic:Topic"],
              field: "name",
              cb: () =>
                output(args.props.fifoTopic).apply((fifo) =>
                  physicalName(256, args.name, fifo ? ".fifo" : undefined),
                ),
            },
            {
              types: ["aws:secretsmanager/secret:Secret"],
              field: "name",
              cb: () => physicalName(512, args.name),
            },
            {
              types: ["aws:appsync/graphQLApi:GraphQLApi"],
              field: "name",
              cb: () => physicalName(65536, args.name),
            },
            {
              types: [
                "cloudflare:index/d1Database:D1Database",
                "cloudflare:index/r2Bucket:R2Bucket",
                "cloudflare:index/workerScript:WorkerScript",
                "cloudflare:index/queue:Queue",
              ],
              field: "name",
              cb: () => physicalName(64, args.name).toLowerCase(),
            },
            {
              types: ["cloudflare:index/workersKvNamespace:WorkersKvNamespace"],
              field: "title",
              cb: () => physicalName(64, args.name).toLowerCase(),
            },
          ];

          const rule = namingRules.find((r) => r.types.includes(args.type));
          if (!rule)
            throw new VisibleError(
              `In "${name}" component, the physical name of "${args.name}" (${args.type}) is not prefixed`,
            );

          // name is already set
          if (args.props[rule.field] && args.props[rule.field] !== "") return;

          return {
            props: { ...args.props, [rule.field]: rule.cb() },
            opts: args.opts,
          };
        },
        // When renaming a CloudFront function, when `deleteBeforeReplace` is not set,
        // the engine tries to remove the existing function first, and fails with in-use
        // error. Setting `deleteBeforeReplace` to `false` seems to force the new one
        // gets created and attached first.
        (args) => {
          let override = {};
          if (args.type === "aws:cloudfront/function:Function") {
            override = { deleteBeforeReplace: false };
          }
          return {
            props: args.props,
            opts: { ...args.opts, ...override },
          };
        },
        // Set child resources `retainOnDelete` if set on component
        (args) => ({
          props: args.props,
          opts: {
            ...args.opts,
            retainOnDelete: args.opts.retainOnDelete ?? opts?.retainOnDelete,
          },
        }),
        ...(opts?.transformations ?? []),
      ],
      ...opts,
    });

    // Check component version
    const oldVersion = $cli.state.version[name];
    const newVersion = _versionInfo._version;
    if (oldVersion) {
      const className = type.replaceAll(":", ".");
      // Invalid forceUpgrade value
      if (
        _versionInfo._forceUpgrade &&
        _versionInfo._forceUpgrade !== `v${newVersion}`
      ) {
        throw new VisibleError(
          [
            `The value of "forceUpgrade" does not match the version of "${className}" component.`,
            `Set "forceUpgrade" to "v${newVersion}" to upgrade to the new version.`,
          ].join("\n"),
        );
      }
      // Version upgraded without forceUpgrade
      if (oldVersion < newVersion && !_versionInfo._forceUpgrade) {
        throw new VisibleError(_versionInfo._message);
      }
      // Version downgraded
      if (oldVersion > newVersion) {
        throw new VisibleError(
          [
            `It seems you are trying to use an older version of "${className}".`,
            `You need to recreate this component to rollback - https://sst.dev/docs/components/#versioning`,
          ].join("\n"),
        );
      }
    }

    // Set version
    if (newVersion > 1) {
      new Version(name, newVersion, { parent: this });
    }
  }
}

const ComponentTransforms = new Map<string, any[]>();
export function $transform<T, Args, Options>(
  resource: { new (name: string, args: Args, opts?: Options): T },
  cb: (args: Args, opts: Options) => void,
) {
  // @ts-expect-error
  const type = resource.__pulumiType;
  if (type.startsWith("sst:")) {
    let transforms = ComponentTransforms.get(type);
    if (!transforms) {
      transforms = [];
      ComponentTransforms.set(type, transforms);
    }
    transforms.push((input: any) => {
      cb(input.props, input.opts);
      return input;
    });
    return;
  }
  runtime.registerStackTransformation((input) => {
    if (input.type !== type) return;
    cb(input.props as any, input.opts as any);
    return input;
  });
}

export function $asset(assetPath: string) {
  const fullPath = path.isAbsolute(assetPath)
    ? assetPath
    : path.join($cli.paths.root, assetPath);

  try {
    return statSync(fullPath).isDirectory()
      ? new pulumiAsset.FileArchive(fullPath)
      : new pulumiAsset.FileAsset(fullPath);
  } catch (e) {
    throw new VisibleError(`Asset not found: ${fullPath}`);
  }
}

export function $lazy<T>(fn: () => T) {
  return output(undefined)
    .apply(async () => output(fn()))
    .apply((x) => x);
}

export function $print(...msg: Input<any>[]) {
  return all(msg).apply((msg) => console.log(...msg));
}

export class Version extends ComponentResource {
  constructor(target: string, version: number, opts: ComponentResourceOptions) {
    super("sst:sst:Version", target + "Version", {}, opts);
    this.registerOutputs({ target, version });
  }
}
