import path from "path";
import fs from "fs";
import { globSync } from "glob";
import crypto from "crypto";
import {
  Output,
  Unwrap,
  output,
  all,
  interpolate,
  ComponentResource,
} from "@pulumi/pulumi";
import { Cdn, CdnArgs } from "./cdn.js";
import { Function, FunctionArgs } from "./function.js";
import { useProvider } from "./helpers/provider.js";
import { Bucket, BucketArgs } from "./bucket.js";
import { BucketFile, BucketFiles } from "./providers/bucket-files.js";
import { logicalName, physicalName } from "../naming.js";
import { Input } from "../input.js";
import { transform, type Prettify, type Transform } from "../component.js";
import { VisibleError } from "../error.js";
import { Cron } from "./cron.js";
import { BaseSiteFileOptions, getContentType } from "../base/base-site.js";
import { BaseSsrSiteArgs } from "../base/base-ssr-site.js";
import {
  cloudfront,
  getPartitionOutput,
  getRegionOutput,
  lambda,
  types,
} from "@pulumi/aws";
import { OriginAccessControl } from "./providers/origin-access-control.js";

type CloudFrontFunctionConfig = { injections: string[] };
type EdgeFunctionConfig = { function: Unwrap<FunctionArgs> };
type ServerOriginConfig = { function: Unwrap<FunctionArgs> };
type ImageOptimizationOriginConfig = {
  function: Unwrap<FunctionArgs>;
};
type S3OriginConfig = {
  originPath?: string;
  copy: {
    from: string;
    to: string;
    cached: boolean;
    versionedSubDir?: string;
  }[];
};
type OriginGroupConfig = {
  primaryOriginName: string;
  fallbackOriginName: string;
  fallbackStatusCodes: number[];
};

export type Plan = ReturnType<typeof validatePlan>;
export interface SsrSiteArgs extends BaseSsrSiteArgs {
  domain?: CdnArgs["domain"];
  permissions?: FunctionArgs["permissions"];
  cachePolicy?: Input<string>;
  invalidation?: Input<
    | false
    | {
        /**
         * Configure if `sst deploy` should wait for the CloudFront cache invalidation to finish.
         *
         * :::tip
         * For non-prod environments it might make sense to pass in `false`.
         * :::
         *
         * Waiting for this process to finish ensures that new content will be available after the deploy finishes. However, this process can sometimes take more than 5 mins.
         * @default `false`
         * @example
         * ```js
         * {
         *   invalidation: {
         *     wait: true
         *   }
         * }
         * ```
         */
        wait?: Input<boolean>;
        /**
         * The paths to invalidate.
         *
         * You can either pass in an array of glob patterns to invalidate specific files. Or you can use one of these built-in options:
         * - `all`: All files will be invalidated when any file changes
         * - `versioned`: Only versioned files will be invalidated when versioned files change
         *
         * :::note
         * Each glob pattern counts as a single invalidation. However, invalidating `all` counts as a single invalidation as well.
         * :::
         * @default `"all"`
         * @example
         * Invalidate the `index.html` and all files under the `products/` route. This counts as two invalidations.
         * ```js
         * {
         *   invalidation: {
         *     paths: ["/index.html", "/products/*"]
         *   }
         * }
         * ```
         */
        paths?: Input<"all" | "versioned" | string[]>;
      }
  >;
  /**
   * The number of instances of the [server function](#nodes-server) to keep warm. This is useful for cases where you are experiencing long cold starts. The default is to not keep any instances warm.
   *
   * This works by starting a serverless cron job to make _n_ concurrent requests to the server function every few minutes. Where _n_ is the number of instances to keep warm.
   *
   * @default `0`
   */
  warm?: Input<number>;
  /**
   * Configure the Lambda function used for server.
   * @default `{architecture: "x86_64", memory: "1024 MB"}`
   */
  server?: {
    /**
     * The amount of memory allocated to the server function.
     * Takes values between 128 MB and 10240 MB in 1 MB increments.
     *
     * @default `"1024 MB"`
     * @example
     * ```js
     * {
     *   server: {
     *     memory: "2048 MB"
     *   }
     * }
     * ```
     */
    memory?: FunctionArgs["memory"];
    /**
     * The [architecture](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html)
     * of the server function.
     *
     * @default `"x86_64"`
     * @example
     * ```js
     * {
     *   server: {
     *     architecture: "arm64"
     *   }
     * }
     * ```
     */
    architecture?: FunctionArgs["architecture"];
    /**
     * Dependencies that need to be excluded from the server function package.
     *
     * Certain npm packages cannot be bundled using esbuild. This allows you to exclude them
     * from the bundle. Instead they'll be moved into a `node_modules/` directory in the
     * function package.
     *
     * :::tip
     * If esbuild is giving you an error about a package, try adding it to the `install` list.
     * :::
     *
     * This will allow your functions to be able to use these dependencies when deployed. They
     * just won't be tree shaken. You however still need to have them in your `package.json`.
     *
     * :::caution
     * Packages listed here still need to be in your `package.json`.
     * :::
     *
     * Esbuild will ignore them while traversing the imports in your code. So these are the
     * **package names as seen in the imports**. It also works on packages that are not directly
     * imported by your code.
     *
     * @example
     * ```js
     * {
     *   server: {
     *     install: ["sharp"]
     *   }
     * }
     * ```
     */
    install?: Input<string[]>;
    /**
     * A list of Lambda layer ARNs to add to the server function.
     *
     * @example
     * ```js
     * {
     *   server: {
     *     layers: ["arn:aws:lambda:us-east-1:123456789012:layer:my-layer:1"]
     *   }
     * }
     * ```
     */
    layers?: Input<Input<string>[]>;
    /**
     * Configure CloudFront Functions to customize the behavior of HTTP requests and responses at the edge.
     */
    edge?: Input<{
      /**
       * Configure the viewer request function.
       *
       * The viewer request function can be used to modify incoming requests before they reach
       * your origin server. For example, you can redirect users, rewrite URLs, or add headers.
       */
      viewerRequest?: Input<{
        /**
         * The code to inject into the viewer request function.
         *
         * By default, a viewer request function is created to add the `x-forwarded-host`
         * header. The given code will be injected at the end of this function.
         *
         * ```js
         * async function handler(event) {
         *   // Default behavior code
         *
         *   // User injected code
         *
         *   return event.request;
         * }
         * ```
         *
         * @example
         * To add a custom header to all requests.
         *
         * ```js
         * {
         *   server: {
         *     edge: {
         *       viewerRequest: {
         *         injection: `event.request.headers["x-foo"] = "bar";`
         *       }
         *     }
         *   }
         * }
         * ```
         *
         * You can use this add basic auth, [check out an example](/docs/examples/#aws-nextjs-basic-auth).
         */
        injection: Input<string>;
        /**
         * The KV stores to associate with the viewer request function.
         *
         * Takes a list of CloudFront KeyValueStore ARNs.
         *
         * @example
         * ```js
         * {
         *   server: {
         *     edge: {
         *       viewerRequest: {
         *         kvStores: ["arn:aws:cloudfront::123456789012:key-value-store/my-store"]
         *       }
         *     }
         *   }
         * }
         * ```
         */
        kvStores?: Input<Input<string>[]>;
      }>;
      /**
       * Configure the viewer response function.
       *
       * The viewer response function can be used to modify outgoing responses before they are
       * sent to the client. For example, you can add security headers or change the response
       * status code.
       */
      viewerResponse?: Input<{
        /**
         * The code to inject into the viewer response function.
         *
         * By default, no viewer response function is set. A new function will be created with
         * the provided code.
         *
         * ```js
         * async function handler(event) {
         *   // User injected code
         *
         *   return event.response;
         * }
         * ```
         *
         * @example
         * To add a custom header to all responses.
         *
         * ```js
         * {
         *   server: {
         *     edge: {
         *       viewerResponse: {
         *         injection: `event.response.headers["x-foo"] = "bar";`
         *       }
         *     }
         *   }
         * }
         * ```
         */
        injection: Input<string>;
        /**
         * The KV stores to associate with the viewer response function.
         *
         * Takes a list of CloudFront KeyValueStore ARNs.
         *
         * @example
         * ```js
         * {
         *   server: {
         *     edge: {
         *       viewerResponse: {
         *         kvStores: ["arn:aws:cloudfront::123456789012:key-value-store/my-store"]
         *       }
         *     }
         *   }
         * }
         * ```
         */
        kvStores?: Input<Input<string>[]>;
      }>;
    }>;
  };
  vpc?: FunctionArgs["vpc"];
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Bucket resource used for uploading the assets.
     */
    assets?: Transform<BucketArgs>;
    /**
     * Transform the server Function resource.
     */
    server?: Transform<FunctionArgs>;
    /**
     * Transform the image optimization Function resource.
     */
    imageOptimization?: Transform<FunctionArgs>;
    /**
     * Transform the CloudFront CDN resource.
     */
    cdn?: Transform<CdnArgs>;
  };
}

export function prepare(parent: ComponentResource, args: SsrSiteArgs) {
  const sitePath = normalizeSitePath();
  const partition = getPartitionOutput(undefined, { parent }).partition;
  const region = getRegionOutput(undefined, { parent }).name;
  checkSupportedRegion();

  return {
    sitePath,
    partition,
    region,
  };

  function normalizeSitePath() {
    return output(args.path).apply((sitePath) => {
      if (!sitePath) return ".";

      if (!fs.existsSync(sitePath)) {
        throw new VisibleError(`No site found at "${path.resolve(sitePath)}"`);
      }
      return sitePath;
    });
  }

  function checkSupportedRegion() {
    region.apply((region) => {
      if (
        ![
          "ap-south-2",
          "ap-southeast-4",
          "eu-south-2",
          "eu-central-2",
          "il-central-1",
          "me-central-1",
        ].includes(region)
      )
        return;
      throw new VisibleError(
        `Region ${region} is not currently supported. Please use a different region.`,
      );
    });
  }
}

export function createBucket(
  parent: ComponentResource,
  name: string,
  partition: Output<string>,
  args: SsrSiteArgs,
) {
  const access = createCloudFrontOriginAccessControl();
  const bucket = createS3Bucket();
  return { access, bucket };

  function createCloudFrontOriginAccessControl() {
    return new OriginAccessControl(
      `${name}S3AccessControl`,
      { name: physicalName(64, name) },
      { parent },
    );
  }

  function createS3Bucket() {
    return new Bucket(
      ...transform(
        args.transform?.assets,
        `${name}Assets`,
        { access: "cloudfront" },
        { parent, retainOnDelete: false },
      ),
    );
  }
}

export function createDevServer(
  parent: ComponentResource,
  name: string,
  args: SsrSiteArgs,
) {
  return new Function(
    ...transform(
      args.transform?.server,
      `${name}DevServer`,
      {
        description: `${name} dev server`,
        runtime: "nodejs20.x",
        timeout: "20 seconds",
        memory: "128 MB",
        bundle: path.join($cli.paths.platform, "functions", "empty-function"),
        handler: "index.handler",
        environment: args.environment,
        permissions: args.permissions,
        link: args.link,
        dev: false,
      },
      { parent },
    ),
  );
}

export function createServersAndDistribution(
  parent: ComponentResource,
  name: string,
  args: SsrSiteArgs,
  outputPath: Output<string>,
  access: OriginAccessControl,
  bucket: Bucket,
  plan: Input<Plan>,
) {
  return all([outputPath, plan]).apply(([outputPath, plan]) => {
    const ssrFunctions: Function[] = [];
    const cfFunctions: Record<string, cloudfront.Function> = {};
    let singletonCachePolicy: cloudfront.CachePolicy;

    const bucketFile = uploadAssets();
    const edgeFunctions = createEdgeFunctions();
    const origins = buildOrigins();
    const originGroups = buildOriginGroups();
    const invalidation = buildInvalidation();
    const distribution = createDistribution();
    createWarmer();

    return {
      distribution,
      ssrFunctions,
      edgeFunctions,
    };

    function uploadAssets() {
      return output(args.assets).apply(async (assets) => {
        // Define content headers
        const versionedFilesTTL = 31536000; // 1 year
        const nonVersionedFilesTTL = 86400; // 1 day

        const bucketFiles: BucketFile[] = [];

        // Handle each S3 origin
        for (const origin of Object.values(plan.origins)) {
          if (!origin.s3) continue;

          // Handle each copy source
          for (const copy of origin.s3.copy) {
            // Build fileOptions
            const fileOptions: BaseSiteFileOptions[] = [
              // unversioned files
              {
                files: "**",
                ignore: copy.versionedSubDir
                  ? path.posix.join(copy.versionedSubDir, "**")
                  : undefined,
                cacheControl:
                  assets?.nonVersionedFilesCacheHeader ??
                  `public,max-age=0,s-maxage=${nonVersionedFilesTTL},stale-while-revalidate=${nonVersionedFilesTTL}`,
              },
              // versioned files
              ...(copy.versionedSubDir
                ? [
                    {
                      files: path.posix.join(copy.versionedSubDir, "**"),
                      cacheControl:
                        assets?.versionedFilesCacheHeader ??
                        `public,max-age=${versionedFilesTTL},immutable`,
                    },
                  ]
                : []),
              ...(assets?.fileOptions ?? []),
            ];

            // Upload files based on fileOptions
            const filesUploaded: string[] = [];
            for (const fileOption of fileOptions.reverse()) {
              const files = globSync(fileOption.files, {
                cwd: path.resolve(outputPath, copy.from),
                nodir: true,
                dot: true,
                ignore: fileOption.ignore,
              }).filter((file) => !filesUploaded.includes(file));

              bucketFiles.push(
                ...(await Promise.all(
                  files.map(async (file) => {
                    const source = path.resolve(outputPath, copy.from, file);
                    const content = await fs.promises.readFile(source);
                    const hash = crypto
                      .createHash("sha256")
                      .update(content)
                      .digest("hex");
                    return {
                      source,
                      key: path.posix.join(copy.to, file),
                      hash,
                      cacheControl: fileOption.cacheControl,
                      contentType:
                        fileOption.contentType ?? getContentType(file, "UTF-8"),
                    };
                  }),
                )),
              );
              filesUploaded.push(...files);
            }
          }
        }

        return new BucketFiles(
          `${name}AssetFiles`,
          {
            bucketName: bucket.name,
            files: bucketFiles,
            purge: false,
            region: getRegionOutput(undefined, { parent }).name,
          },
          { parent },
        );
      });
    }

    function createEdgeFunctions() {
      const functions: Record<string, Function> = {};

      Object.entries(plan.edgeFunctions ?? {}).forEach(
        ([fnName, { function: props }]) => {
          // Edge functions don't support linking
          output(args.link).apply((link) => {
            if (link?.length)
              throw new VisibleError(
                `Resource linking is not currently supported when deploying to the edge.`,
              );
          });

          const fn = new Function(
            `${name}Edge${logicalName(fnName)}`,
            {
              runtime: "nodejs20.x",
              timeout: "20 seconds",
              memory: "1024 MB",
              ...props,
              nodejs: {
                format: "esm" as const,
                ...props.nodejs,
              },
              environment: output(args.environment).apply((environment) => ({
                ...environment,
                ...props.environment,
              })),
              permissions: output(args.permissions).apply((permissions) => [
                {
                  actions: ["cloudfront:CreateInvalidation"],
                  resources: ["*"],
                },
                ...(permissions ?? []),
                ...(props.permissions ?? []),
              ]),
              link: output(args.link).apply((link) => [
                ...(props.link ?? []),
                ...(link ?? []),
              ]),
              transform: {
                function: (args) => {
                  args.publish = true;
                },
              },
              dev: false,
            },
            { provider: useProvider("us-east-1"), parent },
          );

          functions[fnName] = fn;
        },
      );
      return functions;
    }

    function buildOrigins() {
      const origins: Record<string, types.input.cloudfront.DistributionOrigin> =
        {};

      Object.entries(plan.origins ?? {}).forEach(([name, props]) => {
        if (props.s3) {
          origins[name] = buildS3Origin(name, props.s3);
        } else if (props.server) {
          origins[name] = buildServerOrigin(name, props.server);
        } else if (props.imageOptimization) {
          origins[name] = buildImageOptimizationOrigin(
            name,
            props.imageOptimization,
          );
        }
      });

      return origins;
    }

    function buildOriginGroups() {
      const originGroups: Record<
        string,
        types.input.cloudfront.DistributionOriginGroup
      > = {};

      Object.entries(plan.origins ?? {}).forEach(([name, props]) => {
        if (props.group) {
          originGroups[name] = {
            originId: name,
            failoverCriteria: {
              statusCodes: props.group.fallbackStatusCodes,
            },
            members: [
              { originId: props.group.primaryOriginName },
              { originId: props.group.fallbackOriginName },
            ],
          };
        }
      });

      return originGroups;
    }

    function buildS3Origin(name: string, props: S3OriginConfig) {
      return {
        originId: name,
        domainName: bucket.nodes.bucket.bucketRegionalDomainName,
        originPath: props.originPath ? `/${props.originPath}` : "",
        originAccessControlId: access.id,
      };
    }

    function buildServerOrigin(fnName: string, props: ServerOriginConfig) {
      const fn = new Function(
        ...transform(
          args.transform?.server,
          `${name}${logicalName(fnName)}`,
          {
            description: `${name} server`,
            runtime: "nodejs20.x",
            timeout: "20 seconds",
            memory: output(args.server?.memory).apply((v) => v ?? "1024 MB"),
            architecture: output(args.server?.architecture).apply(
              (v) => v ?? "x86_64",
            ),
            vpc: args.vpc,
            ...props.function,
            nodejs: {
              format: "esm" as const,
              install: args.server?.install,
              ...props.function.nodejs,
            },
            environment: output(args.environment).apply((environment) => ({
              ...environment,
              ...props.function.environment,
            })),
            permissions: output(args.permissions).apply((permissions) => [
              {
                actions: ["cloudfront:CreateInvalidation"],
                resources: ["*"],
              },
              ...(permissions ?? []),
              ...(props.function.permissions ?? []),
            ]),
            injections: [
              ...(args.warm
                ? [useServerFunctionWarmingInjection(props.function.streaming)]
                : []),
              ...(props.function.injections || []),
            ],
            link: output(args.link).apply((link) => [
              ...(props.function.link ?? []),
              ...(link ?? []),
            ]),
            layers: output(args.server?.layers).apply((layers) => [
              ...(props.function.layers ?? []),
              ...(layers ?? []),
            ]),
            url: true,
            dev: false,
            _skipHint: true,
          },
          { parent },
        ),
      );
      ssrFunctions.push(fn);

      return {
        originId: fnName,
        domainName: fn.url.apply((url) => new URL(url!).host),
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: "https-only",
          originReadTimeout: 20,
          originSslProtocols: ["TLSv1.2"],
        },
      };
    }

    function buildImageOptimizationOrigin(
      fnName: string,
      props: ImageOptimizationOriginConfig,
    ) {
      const fn = new Function(
        ...transform(
          args.transform?.imageOptimization,
          `${name}${logicalName(fnName)}`,
          {
            timeout: "25 seconds",
            logging: {
              retention: "3 days",
            },
            permissions: [
              {
                actions: ["s3:GetObject"],
                resources: [interpolate`${bucket.arn}/*`],
              },
            ],
            ...props.function,
            url: true,
            dev: false,
            _skipMetadata: true,
            _skipHint: true,
          },
          { parent },
        ),
      );

      return {
        originId: fnName,
        domainName: fn.url.apply((url) => new URL(url!).host),
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: "https-only",
          originReadTimeout: 20,
          originSslProtocols: ["TLSv1.2"],
        },
      };
    }

    function buildBehavior(behavior: Plan["behaviors"][number]) {
      const edgeFunction = edgeFunctions[behavior.edgeFunction || ""];

      if (behavior.cacheType === "static") {
        return {
          targetOriginId: behavior.origin,
          viewerProtocolPolicy: "redirect-to-https",
          allowedMethods: behavior.allowedMethods ?? ["GET", "HEAD", "OPTIONS"],
          cachedMethods: ["GET", "HEAD"],
          compress: true,
          // CloudFront's managed CachingOptimized policy
          cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
          functionAssociations: behavior.cfFunction
            ? [
                {
                  eventType: "viewer-request",
                  functionArn: useCfFunction(
                    "assets",
                    "request",
                    behavior.cfFunction,
                  ).arn,
                },
              ]
            : [],
        };
      } else if (behavior.cacheType === "server") {
        return {
          targetOriginId: behavior.origin,
          viewerProtocolPolicy: "redirect-to-https",
          allowedMethods: behavior.allowedMethods ?? [
            "DELETE",
            "GET",
            "HEAD",
            "OPTIONS",
            "PATCH",
            "POST",
            "PUT",
          ],
          cachedMethods: ["GET", "HEAD"],
          compress: true,
          cachePolicyId: args.cachePolicy ?? useServerBehaviorCachePolicy().id,
          // CloudFront's Managed-AllViewerExceptHostHeader policy
          originRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
          functionAssociations: behavior.cfFunction
            ? [
                {
                  eventType: "viewer-request",
                  functionArn: useCfFunction(
                    "server",
                    "request",
                    behavior.cfFunction,
                  ).arn,
                },
              ]
            : [],
          lambdaFunctionAssociations: edgeFunction
            ? [
                {
                  includeBody: true,
                  eventType: "origin-request",
                  lambdaArn: edgeFunction.nodes.function.qualifiedArn,
                },
              ]
            : [],
        };
      }

      throw new VisibleError(`Invalid behavior type in the "${name}" site.`);
    }

    function useCfFunction(
      origin: "assets" | "server",
      type: "request" | "response",
      fnName: string,
    ) {
      const { injections } = plan.cloudFrontFunctions![fnName];
      const config =
        origin === "server"
          ? output(args.server).apply((server) =>
              type === "request"
                ? server?.edge?.viewerRequest
                : server?.edge?.viewerResponse,
            )
          : output(undefined);
      cfFunctions[fnName] =
        cfFunctions[fnName] ??
        new cloudfront.Function(
          `${name}CloudfrontFunction${logicalName(fnName)}`,
          {
            runtime: "cloudfront-js-2.0",
            keyValueStoreAssociations: config.apply((v) => v?.kvStores ?? []),
            code: interpolate`
async function handler(event) {
  ${injections.join("\n")}
  ${config.apply((v) => v?.injection ?? "")}
  return event.request;
}`,
          },
          { parent },
        );
      return cfFunctions[fnName];
    }

    function useServerBehaviorCachePolicy() {
      singletonCachePolicy =
        singletonCachePolicy ??
        new cloudfront.CachePolicy(
          `${name}ServerCachePolicy`,
          {
            comment: "SST server response cache policy",
            defaultTtl: 0,
            maxTtl: 31536000, // 1 year
            minTtl: 0,
            parametersInCacheKeyAndForwardedToOrigin: {
              cookiesConfig: {
                cookieBehavior: "none",
              },
              headersConfig:
                (plan.serverCachePolicy?.allowedHeaders ?? []).length > 0
                  ? {
                      headerBehavior: "whitelist",
                      headers: {
                        items: plan.serverCachePolicy?.allowedHeaders,
                      },
                    }
                  : {
                      headerBehavior: "none",
                    },
              queryStringsConfig: {
                queryStringBehavior: "all",
              },
              enableAcceptEncodingBrotli: true,
              enableAcceptEncodingGzip: true,
            },
          },
          { parent },
        );
      return singletonCachePolicy;
    }

    function useServerFunctionWarmingInjection(streaming?: boolean) {
      return [
        `if (event.type === "warmer") {`,
        `  const p = new Promise((resolve) => {`,
        `    setTimeout(() => {`,
        `      resolve({ serverId: "server-" + Math.random().toString(36).slice(2, 8) });`,
        `    }, event.delay);`,
        `  });`,
        ...(streaming
          ? [
              `  const response = await p;`,
              `  responseStream.write(JSON.stringify(response));`,
              `  responseStream.end();`,
              `  return;`,
            ]
          : [`  return p;`]),
        `}`,
      ].join("\n");
    }

    function buildInvalidation() {
      return all([outputPath, args.invalidation]).apply(
        ([outputPath, invalidationRaw]) => {
          // Normalize invalidation
          if (invalidationRaw === false) return false;
          const invalidation = {
            wait: false,
            paths: "all",
            ...invalidationRaw,
          };

          // We will generate a hash based on the contents of the S3 files with cache enabled.
          // This will be used to determine if we need to invalidate our CloudFront cache.
          const s3Origin = Object.values(plan.origins).find(
            (origin) => origin.s3,
          )?.s3;
          if (!s3Origin) return false;
          const cachedS3Files = s3Origin.copy.filter((file) => file.cached);
          if (cachedS3Files.length === 0) return false;

          // Build invalidation paths
          const invalidationPaths: string[] = [];
          if (invalidation.paths === "all") {
            invalidationPaths.push("/*");
          } else if (invalidation.paths === "versioned") {
            cachedS3Files.forEach((item) => {
              if (!item.versionedSubDir) return false;
              invalidationPaths.push(
                path.posix.join("/", item.to, item.versionedSubDir, "*"),
              );
            });
          } else {
            invalidationPaths.push(...(invalidation?.paths || []));
          }
          if (invalidationPaths.length === 0) return false;

          // Build build ID
          let invalidationBuildId: string;
          if (plan.buildId) {
            invalidationBuildId = plan.buildId;
          } else {
            const hash = crypto.createHash("md5");

            cachedS3Files.forEach((item) => {
              // The below options are needed to support following symlinks when building zip files:
              // - nodir: This will prevent symlinks themselves from being copied into the zip.
              // - follow: This will follow symlinks and copy the files within.

              // For versioned files, use file path for digest since file version in name should change on content change
              if (item.versionedSubDir) {
                globSync("**", {
                  dot: true,
                  nodir: true,
                  follow: true,
                  cwd: path.resolve(
                    outputPath,
                    item.from,
                    item.versionedSubDir,
                  ),
                }).forEach((filePath) => hash.update(filePath));
              }

              // For non-versioned files, use file content for digest
              if (invalidation.paths !== "versioned") {
                globSync("**", {
                  ignore: item.versionedSubDir
                    ? [path.posix.join(item.versionedSubDir, "**")]
                    : undefined,
                  dot: true,
                  nodir: true,
                  follow: true,
                  cwd: path.resolve(outputPath, item.from),
                }).forEach((filePath) =>
                  hash.update(
                    fs.readFileSync(
                      path.resolve(outputPath, item.from, filePath),
                    ),
                  ),
                );
              }
            });
            invalidationBuildId = hash.digest("hex");
          }

          return {
            paths: invalidationPaths,
            token: invalidationBuildId,
            wait: invalidation.wait,
          };
        },
      );
    }

    function createDistribution() {
      return new Cdn(
        ...transform(
          args.transform?.cdn,
          `${name}Cdn`,
          {
            comment: `${name} app`,
            origins: Object.values(origins),
            originGroups: Object.values(originGroups),
            defaultRootObject: plan.defaultRootObject ?? "",
            defaultCacheBehavior: buildBehavior(
              plan.behaviors.find((behavior) => !behavior.pattern)!,
            ),
            orderedCacheBehaviors: plan.behaviors
              .filter((behavior) => behavior.pattern)
              .map((behavior) => ({
                pathPattern: behavior.pattern!,
                ...buildBehavior(behavior),
              })),
            customErrorResponses: plan.errorResponses,
            domain: args.domain,
            invalidation,
          },
          // create distribution after assets are uploaded
          { dependsOn: bucketFile, parent },
        ),
      );
    }

    function createWarmer() {
      // note: Currently all sites have a single server function. When we add
      //       support for multiple server functions (ie. route splitting), we
      //       need to handle warming multiple functions.
      if (!args.warm) return;

      if (args.warm && plan.edge) {
        throw new VisibleError(
          `In the "${name}" Site, warming is currently supported only for the regional mode.`,
        );
      }

      if (ssrFunctions.length === 0) return;

      // Create cron job
      const cron = new Cron(
        `${name}Warmer`,
        {
          schedule: "rate(5 minutes)",
          job: {
            description: `${name} warmer`,
            bundle: path.join($cli.paths.platform, "dist", "ssr-warmer"),
            runtime: "nodejs20.x",
            handler: "index.handler",
            timeout: "900 seconds",
            memory: "128 MB",
            dev: false,
            environment: {
              FUNCTION_NAME: ssrFunctions[0].nodes.function.name,
              CONCURRENCY: output(args.warm).apply((warm) => warm.toString()),
            },
            link: [ssrFunctions[0]],
            _skipMetadata: true,
          },
          transform: {
            target: (args) => {
              args.retryPolicy = {
                maximumRetryAttempts: 0,
                maximumEventAgeInSeconds: 60,
              };
            },
          },
        },
        { parent },
      );

      // Prewarm on deploy
      new lambda.Invocation(
        `${name}Prewarm`,
        {
          functionName: cron.nodes.job.name,
          triggers: {
            version: Date.now().toString(),
          },
          input: JSON.stringify({}),
        },
        { parent },
      );
    }
  });
}

export function useCloudFrontFunctionHostHeaderInjection() {
  return `event.request.headers["x-forwarded-host"] = event.request.headers.host;`;
}

export function validatePlan<
  CloudFrontFunctions extends Record<
    string,
    Prettify<CloudFrontFunctionConfig>
  >,
  EdgeFunctions extends Record<string, Prettify<EdgeFunctionConfig>>,
  Origins extends Record<
    string,
    {
      server?: Prettify<ServerOriginConfig>;
      imageOptimization?: Prettify<ImageOptimizationOriginConfig>;
      s3?: Prettify<S3OriginConfig>;
      group?: Prettify<OriginGroupConfig>;
    }
  >,
>(input: {
  cloudFrontFunctions?: CloudFrontFunctions;
  edgeFunctions?: EdgeFunctions;
  /**
   * Each origin can be either an S3, server, image optimization, or group origin.
   */
  origins: Origins;
  edge: boolean;
  behaviors: {
    cacheType: "server" | "static";
    pattern?: string;
    origin: keyof Origins;
    allowedMethods?: (
      | "DELETE"
      | "GET"
      | "HEAD"
      | "OPTIONS"
      | "PATCH"
      | "POST"
      | "PUT"
    )[];
    cfFunction?: keyof CloudFrontFunctions;
    edgeFunction?: keyof EdgeFunctions;
  }[];
  defaultRootObject?: cloudfront.DistributionArgs["defaultRootObject"];
  errorResponses?: types.input.cloudfront.DistributionCustomErrorResponse[];
  serverCachePolicy?: {
    allowedHeaders?: string[];
  };
  buildId?: string;
}) {
  Object.entries(input.origins).forEach(([originName, origin]) => {
    if (
      !origin.s3 &&
      !origin.server &&
      !origin.imageOptimization &&
      !origin.group
    ) {
      throw new VisibleError(
        `Invalid origin "${originName}" definition. Each origin must be an S3, server, image optimization, or group origin.`,
      );
    }
  });
  return input;
}
