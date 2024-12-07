import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Function } from "./function.js";
import {
  SsrSiteArgs,
  createBucket,
  createDevServer,
  createServersAndDistribution,
  prepare,
  useCloudFrontFunctionHostHeaderInjection,
  validatePlan,
} from "./ssr-site.js";
import { Cdn } from "./cdn.js";
import { Bucket } from "./bucket.js";
import { Component } from "../component.js";
import { Link } from "../link.js";
import type { Input } from "../input.js";
import { buildApp } from "../base/base-ssr-site.js";
import { URL_UNAVAILABLE } from "./linkable.js";
import { VisibleError } from "../error.js";

export interface RemixArgs extends SsrSiteArgs {
  /**
   * Configure how this component works in `sst dev`.
   *
   * :::note
   * In `sst dev` your Remix app is run in dev mode; it's not deployed.
   * :::
   *
   * Instead of deploying your Remix app, this starts it in dev mode. It's run
   * as a separate process in the `sst dev` multiplexer. Read more about
   * [`sst dev`](/docs/reference/cli/#dev).
   *
   * To disable dev mode, pass in `false`.
   */
  dev?: SsrSiteArgs["dev"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your Remix app needs to access. These permissions are used to create the function's IAM role.
   *
   * :::tip
   * If you `link` the function to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow reading and writing to an S3 bucket called `my-bucket`.
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
   * Perform all actions on an S3 bucket called `my-bucket`.
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
   * Grant permissions to access all resources.
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
  permissions?: SsrSiteArgs["permissions"];
  /**
   * Path to the directory where your Remix app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your Remix app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your Remix app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your Remix app. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your site using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of resources to link to the function.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: SsrSiteArgs["link"];
  /**
   * Configure how the CloudFront cache invalidations are handled. This is run after your Remix app has been deployed.
   * :::tip
   * You get 1000 free invalidations per month. After that you pay $0.005 per invalidation path. [Read more here](https://aws.amazon.com/cloudfront/pricing/).
   * :::
   * @default `{paths: "all", wait: false}`
   * @example
   * Wait for all paths to be invalidated.
   * ```js
   * {
   *   invalidation: {
   *     paths: "all",
   *     wait: true
   *   }
   * }
   * ```
   */
  invalidation?: SsrSiteArgs["invalidation"];
  /**
   * Set [environment variables](https://remix.run/docs/en/main/guides/envvars) in your Remix app. These are made available:
   *
   * 1. In `remix build`, they are loaded into `process.env`.
   * 2. Locally while running through `sst dev`.
   *
   * :::tip
   * You can also `link` resources to your Remix app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
   * :::
   *
   * @example
   * ```js
   * {
   *   environment: {
   *     API_URL: api.url,
   *     STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   *   }
   * }
   * ```
   */
  environment?: SsrSiteArgs["environment"];
  /**
   * Set a custom domain for your Remix app.
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
   *
   * Specify a `www.` version of the custom domain.
   *
   * ```js
   * {
   *   domain: {
   *     name: "domain.com",
   *     redirects: ["www.domain.com"]
   *   }
   * }
   * ```
   */
  domain?: SsrSiteArgs["domain"];
  /**
   * The command used internally to build your Remix app.
   *
   * @default `"npm run build"`
   *
   * @example
   *
   * If you want to use a different build command.
   * ```js
   * {
   *   buildCommand: "yarn build"
   * }
   * ```
   */
  buildCommand?: SsrSiteArgs["buildCommand"];
  /**
   * The directory where the build output is located. This should match the value of
   * `buildDirectory` in the Remix plugin section of your Vite config.
   *
   * @default `"build"`
   */
  buildDirectory?: Input<string>;
  /**
   * Configure how the Remix app assets are uploaded to S3.
   *
   * By default, this is set to the following. Read more about these options below.
   * ```js
   * {
   *   assets: {
   *     textEncoding: "utf-8",
   *     versionedFilesCacheHeader: "public,max-age=31536000,immutable",
   *     nonVersionedFilesCacheHeader: "public,max-age=0,s-maxage=86400,stale-while-revalidate=8640"
   *   }
   * }
   * ```
   */
  assets?: SsrSiteArgs["assets"];
  /**
   * Configure where the [server function](#nodes-server) is deployed.
   *
   * By default, it's deployed to AWS Lambda in a single region. Enable this option if you want to instead deploy it to Lambda@Edge.
   * @default `false`
   * @internal
   */
  edge?: Input<boolean>;
  /**
   * Configure the [server function](#nodes-server) in your Remix app to connect
   * to private subnets in a virtual private cloud or VPC. This allows your app to
   * access private resources.
   *
   * @example
   * ```js
   * {
   *   vpc: {
   *     securityGroups: ["sg-0399348378a4c256c"],
   *     subnets: ["subnet-0b6a2b73896dc8c4c", "subnet-021389ebee680c2f0"]
   *   }
   * }
   * ```
   */
  vpc?: SsrSiteArgs["vpc"];
  /**
   * Configure the Remix app to use an existing CloudFront cache policy.
   *
   * :::note
   * CloudFront has a limit of 20 cache policies per account, though you can request a limit
   * increase.
   * :::
   *
   * By default, a new cache policy is created for it. This allows you to reuse an existing
   * policy instead of creating a new one.
   *
   * @default A new cache plolicy is created
   *
   * @example
   * ```js
   * {
   *   cachePolicy: "658327ea-f89d-4fab-a63d-7e88639e58f6"
   * }
   * ```
   */
  cachePolicy?: SsrSiteArgs["cachePolicy"];
}

/**
 * The `Remix` component lets you deploy a [Remix](https://remix.run) app to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a Remix app that's in the project root.
 *
 * ```js title="sst.config.ts"
 * new sst.aws.Remix("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the Remix app in the `my-remix-app/` directory.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Remix("MyWeb", {
 *   path: "my-remix-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Remix app.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Remix("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4} title="sst.config.ts"
 * new sst.aws.Remix("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your Remix app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4} title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.Remix("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your Remix app.
 *
 * ```ts title="app/root.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class Remix extends Component implements Link.Linkable {
  private cdn?: Output<Cdn>;
  private assets?: Bucket;
  private server?: Output<Function>;
  private devUrl?: Output<string>;

  constructor(
    name: string,
    args: RemixArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const edge = normalizeEdge();
    const { sitePath, partition } = prepare(parent, args);
    const dev = normalizeDev();

    if (dev) {
      const server = createDevServer(parent, name, args);
      this.devUrl = dev.url;
      this.registerOutputs({
        _metadata: {
          mode: "placeholder",
          path: sitePath,
          edge,
          server: server.arn,
        },
        _dev: {
          links: output(args.link || [])
            .apply(Link.build)
            .apply((links) => links.map((link) => link.name)),
          aws: {
            role: server.nodes.role.arn,
          },
          environment: args.environment,
          command: dev.command,
          directory: dev.directory,
          autostart: dev.autostart,
        },
      });
      return;
    }

    const viteConfig = loadViteConfig();
    const { access, bucket } = createBucket(parent, name, partition, args);
    const outputPath = buildApp(parent, name, args, sitePath);
    const buildMeta = loadBuildMetadata();
    const plan = buildPlan();
    const { distribution, ssrFunctions, edgeFunctions } =
      createServersAndDistribution(
        parent,
        name,
        args,
        outputPath,
        access,
        bucket,
        plan,
      );
    const serverFunction = ssrFunctions[0] ?? Object.values(edgeFunctions)[0];

    this.assets = bucket;
    this.cdn = distribution;
    this.server = serverFunction;
    this.registerOutputs({
      _hint: all([this.cdn.domainUrl, this.cdn.url]).apply(
        ([domainUrl, url]) => domainUrl ?? url,
      ),
      _metadata: {
        mode: "deployed",
        path: sitePath,
        url: distribution.apply((d) => d.domainUrl ?? d.url),
        edge,
        server: serverFunction.arn,
      },
    });

    function normalizeDev() {
      if (!$dev) return undefined;
      if (args.dev === false) return undefined;

      return {
        ...args.dev,
        url: output(args.dev?.url ?? URL_UNAVAILABLE),
        command: output(args.dev?.command ?? "npm run dev"),
        autostart: output(args.dev?.autostart ?? true),
        directory: output(args.dev?.directory ?? sitePath),
      };
    }

    function normalizeEdge() {
      return output(args?.edge).apply((edge) => edge ?? false);
    }

    function loadViteConfig() {
      return all([sitePath, args.buildDirectory]).apply(
        async ([sitePath, buildDirectory]) => {
          const file = [
            "vite.config.ts",
            "vite.config.js",
            "vite.config.mts",
            "vite.config.mjs",
          ].find((filename) => fs.existsSync(path.join(sitePath, filename)));
          if (!file) return;

          let resolvedConfig;
          try {
            const vite = await import("vite");
            const viteConfig = await vite.loadConfigFromFile(
              { command: "build", mode: "production" },
              path.join(sitePath, file),
            );
            if (!viteConfig) throw new Error();

            resolvedConfig = {
              __remixPluginContext: {
                remixConfig: {
                  buildDirectory: buildDirectory ?? "build",
                },
              },
            };
          } catch (e) {
            throw new VisibleError(`Failed to load Vite config file "${file}"`);
          }

          return resolvedConfig;
        },
      );
    }

    function loadBuildMetadata() {
      return all([outputPath, viteConfig]).apply(
        async ([outputPath, viteConfig]) => {
          // The path for all files that need to be in the "/" directory (static assets)
          // is different when using Vite. These will be located in the "build/client"
          // path of the output by default. It will be the "public" folder when using remix config.
          let assetsPath = "public";
          let assetsVersionedSubDir = "build";
          let buildPath = path.join(outputPath, "build");

          if (viteConfig) {
            assetsPath = path.join(
              viteConfig.__remixPluginContext.remixConfig.buildDirectory,
              "client",
            );
            assetsVersionedSubDir = "assets";
            buildPath = path.join(
              outputPath,
              viteConfig.__remixPluginContext.remixConfig.buildDirectory,
            );
          }

          return {
            buildPath,
            assetsPath,
            assetsVersionedSubDir,
            // create 1 behaviour for each top level asset file/folder
            staticRoutes: fs
              .readdirSync(path.join(outputPath, assetsPath), {
                withFileTypes: true,
              })
              .map((item) =>
                item.isDirectory() ? `${item.name}/*` : item.name,
              ),
          };
        },
      );
    }

    function buildPlan() {
      return all([viteConfig, edge, buildMeta]).apply(
        ([viteConfig, edge, buildMeta]) => {
          const serverConfig = createServerLambdaBundle(
            viteConfig,
            buildMeta.buildPath,
            edge,
          );

          return validatePlan({
            edge,
            cloudFrontFunctions: {
              serverCfFunction: {
                injections: [useCloudFrontFunctionHostHeaderInjection()],
              },
              staticCfFunction: {
                injections: [
                  // Note: When using libraries like remix-flat-routes the file can
                  // contains special characters like "+". It needs to be encoded.
                  `event.request.uri = event.request.uri.split('/').map(encodeURIComponent).join('/');`,
                ],
              },
            },
            edgeFunctions: edge
              ? {
                  server: {
                    function: serverConfig,
                  },
                }
              : undefined,
            origins: {
              ...(edge
                ? {}
                : {
                    server: {
                      server: {
                        function: serverConfig,
                      },
                    },
                  }),
              s3: {
                s3: {
                  copy: [
                    {
                      from: buildMeta.assetsPath,
                      to: "",
                      cached: true,
                      versionedSubDir: buildMeta.assetsVersionedSubDir,
                    },
                  ],
                },
              },
            },
            behaviors: [
              edge
                ? {
                    cacheType: "server",
                    cfFunction: "serverCfFunction",
                    edgeFunction: "server",
                    origin: "s3",
                  }
                : {
                    cacheType: "server",
                    cfFunction: "serverCfFunction",
                    origin: "server",
                  },
              ...buildMeta.staticRoutes.map(
                (route) =>
                  ({
                    cacheType: "static",
                    pattern: route,
                    cfFunction: "staticCfFunction",
                    origin: "s3",
                  }) as const,
              ),
            ],
          });
        },
      );
    }

    function createServerLambdaBundle(
      viteConfig: any,
      buildPath: string,
      isEdge: boolean,
    ) {
      // Create a Lambda@Edge handler for the Remix server bundle.
      //
      // Note: Remix does perform their own internal ESBuild process, but it
      // doesn't bundle 3rd party dependencies by default. In the interest of
      // keeping deployments seamless for users we will create a server bundle
      // with all dependencies included. We will still need to consider how to
      // address any need for external dependencies, although I think we should
      // possibly consider this at a later date.

      // In this path we are assuming that the Remix build only outputs the
      // "core server build". We can safely assume this as we have guarded the
      // remix.config.js to ensure it matches our expectations for the build
      // configuration.
      // We need to ensure that the "core server build" is wrapped with an
      // appropriate Lambda@Edge handler. We will utilise an internal asset
      // template to create this wrapper within the "core server build" output
      // directory.

      // Ensure build directory exists
      fs.mkdirSync(buildPath, { recursive: true });

      // Copy the server lambda handler and pre-append the build injection based
      // on the config file used.
      const content = [
        // When using Vite config, the output build will be "server/index.js"
        // and when using Remix config it will be `server.js`.
        `// Import the server build that was produced by 'remix build'`,
        viteConfig
          ? `import * as remixServerBuild from "./server/index.js";`
          : `import * as remixServerBuild from "./index.js";`,
        ``,
        fs.readFileSync(
          path.join(
            $cli.paths.platform,
            "functions",
            "remix-server",
            isEdge ? "edge-server.mjs" : "regional-server.mjs",
          ),
        ),
      ].join("\n");
      fs.writeFileSync(path.join(buildPath, "server.mjs"), content);

      // Copy the Remix polyfil to the server build directory
      //
      // Note: We need to ensure that the polyfills are injected above other code that
      // will depend on them when not using Vite. Importing them within the top of the
      // lambda code doesn't appear to guarantee this, we therefore leverage ESBUild's
      // `inject` option to ensure that the polyfills are injected at the top of
      // the bundle.
      const polyfillDest = path.join(buildPath, "polyfill.mjs");
      fs.copyFileSync(
        path.join(
          $cli.paths.platform,
          "functions",
          "remix-server",
          "polyfill.mjs",
        ),
        polyfillDest,
      );

      return {
        handler: path.join(buildPath, "server.handler"),
        nodejs: {
          esbuild: {
            inject: [path.resolve(polyfillDest)],
          },
        },
        streaming: !isEdge,
      };
    }
  }

  /**
   * The URL of the Remix app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the autogenerated CloudFront URL.
   */
  public get url() {
    return all([this.cdn?.domainUrl, this.cdn?.url, this.devUrl]).apply(
      ([domainUrl, url, dev]) => domainUrl ?? url ?? dev!,
    );
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The AWS Lambda server function that renders the site.
       */
      server: this.server,
      /**
       * The Amazon S3 Bucket that stores the assets.
       */
      assets: this.assets,
      /**
       * The Amazon CloudFront CDN that serves the app.
       */
      cdn: this.cdn,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: this.url,
      },
    };
  }
}

const __pulumiType = "sst:aws:Remix";
// @ts-expect-error
Remix.__pulumiType = __pulumiType;
