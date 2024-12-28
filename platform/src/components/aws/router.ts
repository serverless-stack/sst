import { ComponentResourceOptions, all, output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import type { Input } from "../input";
import { Cdn, CdnArgs } from "./cdn";
import { cloudfront, types } from "@pulumi/aws";
import { hashStringToPrettyString, physicalName } from "../naming";
import { Bucket } from "./bucket";
import { OriginAccessControl } from "./providers/origin-access-control";

export interface RouterUrlRouteArgs extends BaseRouteArgs {
  /**
   * The destination URL.
   *
   * @example
   *
   * ```js
   * {
   *   routes: {
   *     "/api/*": {
   *       url: "https://example.com"
   *     }
   *   }
   * }
   * ```
   */
  url: Input<string>;
  /**
   * Rewrite the request path.
   *
   * @example
   *
   * By default, if the route path is `/api/*` and a request comes in for `/api/users/profile`,
   * the request path the destination sees is `/api/users/profile`.
   *
   * If you want to serve the route from the root, you can rewrite the request path to
   * `/users/profile`.
   *
   * ```js
   * {
   *   routes: {
   *     "/api/*": {
   *       url: "https://api.example.com",
   *       rewrite: {
   *         regex: "^/api/(.*)$",
   *         to: "/$1"
   *       }
   *     }
   *   }
   * }
   * ```
   */
  rewrite?: Input<{
    /**
     * The regex to match the request path.
     */
    regex: Input<string>;
    /**
     * The replacement for the matched path.
     */
    to: Input<string>;
  }>;
}

export interface RouterBucketRouteArgs extends BaseRouteArgs {
  /**
   * A bucket to route to.
   *
   * :::note
   * You need to let CloudFront `access` the bucket.
   * :::
   *
   * @example
   *
   * For example, let's say you have a bucket that gives CloudFront `access`.
   *
   * ```ts title="sst.config.ts" {2}
   * const myBucket = new sst.aws.Bucket("MyBucket", {
   *   access: "cloudfront"
   * });
   * ```
   *
   * You can then this directly as the destination for the route.
   *
   * ```js
   * {
   *   routes: {
   *     "/files/*": {
   *       bucket: myBucket
   *     }
   *   }
   * }
   * ```
   *
   * Or if you have an existing bucket, you can pass in its regional domain.
   *
   * ```js
   * {
   *   routes: {
   *     "/files/*": {
   *       bucket: "my-bucket.s3.us-east-1.amazonaws.com"
   *     }
   *   }
   * }
   * ```
   */
  bucket?: Input<Bucket | string>;
  /**
   * Rewrite the request path.
   *
   * @example
   *
   * By default, if the route path is `/files/*` and a request comes in for `/files/logo.png`,
   * the request path the destination sees is `/files/logo.png`. In the case of a bucket route,
   * the file `logo.png` is served from the `files` directory in the bucket.
   *
   * If you want to serve the file from the root of the bucket, you can rewrite
   * the request path to `/logo.png`.
   *
   * ```js
   * {
   *   routes: {
   *     "/files/*": {
   *       bucket: myBucket,
   *       rewrite: {
   *         regex: "^/files/(.*)$",
   *         to: "/$1"
   *       }
   *     }
   *   }
   * }
   * ```
   */
  rewrite?: Input<{
    /**
     * The regex to match the request path.
     */
    regex: Input<string>;
    /**
     * The replacement for the matched path.
     */
    to: Input<string>;
  }>;
}

interface BaseRouteArgs {
  /**
   * Configure CloudFront Functions to customize the behavior of HTTP requests and responses at the edge.
   */
  edge?: {
    /**
     * Configure the viewer request function.
     *
     * The viewer request function can be used to modify incoming requests before they
     * reach your origin server. For example, you can redirect users, rewrite URLs,
     * or add headers.
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
       *   routes: {
       *     "/api/*": {
       *       edge: {
       *         viewerRequest: {
       *           kvStores: ["arn:aws:cloudfront::123456789012:key-value-store/my-store"]
       *         }
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
     * The viewer response function can be used to modify outgoing responses before
     * they are sent to the client. For example, you can add security headers or change
     * the response status code.
     *
     * By default, no viewer response function is set. A new function will be created
     * with the provided code.
     *
     * @example
     * Add a custom header to all responses
     * ```js
     * {
     *   routes: {
     *     "/api/*": {
     *       edge: {
     *         viewerResponse: {
     *           injection: `event.response.headers["x-foo"] = "bar";`
     *         }
     *       }
     *     }
     *   }
     * }
     * ```
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
       *   routes: {
       *     "/api/*": {
       *       edge: {
       *         viewerResponse: {
       *           kvStores: ["arn:aws:cloudfront::123456789012:key-value-store/my-store"]
       *         }
       *       }
       *     }
       *   }
       * }
       * ```
       */
      kvStores?: Input<Input<string>[]>;
    }>;
  };
}

export interface RouterArgs {
  /**
   * Set a custom domain for your Router.
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
  domain?: CdnArgs["domain"];
  /**
   * A map of routes to their destinations. The _key_ is the route path and the
   * _value_ can be:
   *
   * - The destination URL as a string
   * - Or, an object with
   *   - Args for a URL route
   *   - Args for a bucket route
   *
   * :::note
   * All routes need to start with `/`.
   * :::
   *
   * For example, you can set the destination as a URL.
   *
   * ```ts
   * {
   *   routes: {
   *     "/*": "https://example.com"
   *   }
   * }
   * ```
   *
   * Or, you can route to a bucket.
   *
   * ```ts
   * {
   *   routes: {
   *     "/files/*": {
   *       bucket: myBucket
   *     }
   *   }
   * }
   * ```
   *
   * When router receives a request, the requested path is compared with path patterns
   * in the order they are listed. The first match determines which URL the
   * request is routed to.
   *
   * :::tip[Default Route]
   * The `/*` route is a default or catch-all route.
   * :::
   *
   * The `/*` route is a _default_ route, meaning that if no routes match, the `/*` route will be used. It does not matter where the `/*` route is listed in the routes object.
   *
   * :::note
   * If you don't have a `/*` route, you'll get a 404 error for any requests that don't match a route.
   * :::
   *
   * Suppose you have the following three routes.
   *
   * ```js
   * {
   *   routes: {
   *     "/api/*.json": "https://example1.com",
   *     "/api/*": "https://example2.com",
   *     "/*.xml": "https://example3.com",
   *   }
   * }
   * ```
   *
   * A request to `/api/sample.xml` will match `/api/*` first and route to it; even though it matches `/*.xml`.
   *
   * However for this case, a request to `/api/users` will route to `/api/*` even though it comes after `/*`. This is because the `/*` route is the default route.
   *
   * ```js
   * {
   *   routes: {
   *     "/*": "myapp.com",
   *     "/api/*": myFunction.url
   *   }
   * }
   * ```
   *
   * You can also customize the route behavior with injecting some code into the CloudFront
   * Functions. To do so, pass in an object, with the destination as the `url`.
   *
   * ```ts
   * {
   *   routes: {
   *     "/*": {
   *       url: "https://example.com",
   *       edge: {
   *         viewerRequest: {
   *           injection: `event.request.headers["x-foo"] = "bar";`
   *         }
   *       }
   *     }
   *   }
   * }
   * ```
   *
   * You can also `rewrite` the request path.
   *
   * ```ts
   * {
   *   routes: {
   *     "/files/*": {
   *       bucket: myBucket,
   *       rewrite: {
   *         regex: "^/files/(.*)$",
   *         to: "/$1"
   *       }
   *     }
   *   }
   * }
   * ```
   */
  routes: Input<
    Record<string, Input<string | RouterUrlRouteArgs | RouterBucketRouteArgs>>
  >;
  /**
   * Configure how the CloudFront cache invalidations are handled.
   * :::tip
   * You get 1000 free invalidations per month. After that you pay $0.005 per invalidation path. [Read more here](https://aws.amazon.com/cloudfront/pricing/).
   * :::
   * @default Invalidation is turned off
   * @example
   * Enable invalidations. Setting this to `true` will invalidate all paths. It is equivalent
   * to passing in `{ paths: ["/*"] }`.
   *
   * ```js
   * {
   *   invalidation: true
   * }
   * ```
   */
  invalidation?: CdnArgs["invalidation"];
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Cache Policy that's attached to each CloudFront behavior.
     */
    cachePolicy?: Transform<cloudfront.CachePolicyArgs>;
    /**
     * Transform the CloudFront CDN resource.
     */
    cdn?: Transform<CdnArgs>;
  };
  /**
   * @internal
   */
  _skipHint?: boolean;
}

interface RouterRef {
  ref: boolean;
  distributionID: Input<string>;
}

/**
 * The `Router` component lets you use a CloudFront distribution to direct requests to various parts of your application.
 * The `routes` prop can route requests to function URLs, different domains, or any component that has an associated URL.
 *
 * @example
 *
 * #### Minimal example
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Router("MyRouter", {
 *   routes: {
 *     "/*": "https://some-internal-service.com"
 *   }
 * });
 * ```
 *
 * #### Route to a function URL
 *
 * ```ts title="sst.config.ts"
 * const myFunction = new sst.aws.Function("MyFunction", {
 *   handler: "src/api.handler",
 *   url: true,
 * });
 *
 * new sst.aws.Router("MyRouter", {
 *   routes: {
 *     "/*": myFunction.url
 *   }
 * });
 * ```
 *
 * #### Route to a bucket
 *
 * ```ts title="sst.config.ts" {2}
 * const myBucket = new sst.aws.Bucket("MyBucket", {
 *   access: "cloudfront"
 * });
 *
 * new sst.aws.Router("MyRouter", {
 *   routes: {
 *     "/files/*": {
 *       bucket: myBucket
 *     }
 *   }
 * });
 * ```
 *
 * Make sure to allow CloudFront access to the bucket by setting the `access` prop on the bucket.
 *
 * #### Route all API requests separately
 *
 * ```ts {4} title="sst.config.ts"
 * new sst.aws.Router("MyRouter", {
 *   routes: {
 *     "/*": "https://myapp.com",
 *     "/api/*": myFunction.url
 *   }
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * ```ts {2} title="sst.config.ts"
 * new sst.aws.Router("MyRouter", {
 *   domain: "myapp.com",
 *   routes: {
 *     "/*": myFunction.url
 *   }
 * });
 * ```
 */
export class Router extends Component implements Link.Linkable {
  private cdn: Cdn;

  constructor(
    name: string,
    args: RouterArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
    const parent = this;

    if (args && "ref" in args) {
      const ref = reference();
      this.cdn = ref.cdn;
      registerOutputs();
      return;
    }

    let defaultCfFunction: cloudfront.Function;
    let defaultOac: OriginAccessControl;
    const routes = normalizeRoutes();

    const cachePolicy = createCachePolicy();
    const cdn = createCdn();

    this.cdn = cdn;
    registerOutputs();

    function reference() {
      const ref = args as unknown as RouterRef;
      const cdn = Cdn.get(`${name}Cdn`, ref.distributionID, { parent });
      return { cdn };
    }

    function registerOutputs() {
      parent.registerOutputs({
        _hint: args._skipHint ? undefined : parent.url,
      });
    }

    function normalizeRoutes() {
      return output(args.routes).apply((routes) => {
        return Object.fromEntries(
          Object.entries(routes).map(([path, route]) => {
            // Route path must start with "/"
            if (!path.startsWith("/"))
              throw new Error(
                `In "${name}" Router, the route path "${path}" must start with a "/"`,
              );

            if (
              typeof route !== "string" &&
              "url" in route &&
              "bucket" in route
            )
              throw new Error(
                `In "${name}" Router, the route path "${path}" cannot have both a url and a bucket`,
              );

            return [path, typeof route === "string" ? { url: route } : route];
          }),
        );
      });
    }

    function createCfRequestDefaultFunction() {
      defaultCfFunction =
        defaultCfFunction ??
        new cloudfront.Function(
          `${name}CloudfrontFunction`,
          {
            runtime: "cloudfront-js-2.0",
            code: [
              `async function handler(event) {`,
              `  event.request.headers["x-forwarded-host"] = event.request.headers.host;`,
              `  return event.request;`,
              `}`,
            ].join("\n"),
          },
          { parent },
        );
      return defaultCfFunction;
    }

    function createCfRequestFunction(
      path: string,
      config:
        | {
            injection: string;
            kvStores?: string[];
          }
        | undefined,
      rewrite:
        | {
            regex: string;
            to: string;
          }
        | undefined,
      injectHostHeader: boolean,
    ) {
      return new cloudfront.Function(
        `${name}CloudfrontFunction${hashStringToPrettyString(path, 8)}`,
        {
          runtime: "cloudfront-js-2.0",
          keyValueStoreAssociations: config?.kvStores ?? [],
          code: `
async function handler(event) {
  ${
    injectHostHeader
      ? `event.request.headers["x-forwarded-host"] = event.request.headers.host;`
      : ""
  }
  ${
    rewrite
      ? `
const re = new RegExp("${rewrite.regex}");
event.request.uri = event.request.uri.replace(re, "${rewrite.to}");`
      : ""
  }
  ${config?.injection ?? ""}
  return event.request;
}`,
        },
        { parent },
      );
    }

    function createCfResponseFunction(
      path: string,
      config: {
        injection: string;
        kvStores?: string[];
      },
    ) {
      return new cloudfront.Function(
        `${name}CloudfrontFunctionResponse${hashStringToPrettyString(path, 8)}`,
        {
          runtime: "cloudfront-js-2.0",
          keyValueStoreAssociations: config!.kvStores ?? [],
          code: `
async function handler(event) {
  ${config.injection ?? ""}
  return event.response;
}`,
        },
        { parent },
      );
    }

    function createOriginAccessControl() {
      defaultOac =
        defaultOac ??
        new OriginAccessControl(
          `${name}S3AccessControl`,
          { name: physicalName(64, name) },
          { parent },
        );
      return defaultOac;
    }

    function createCachePolicy() {
      return new cloudfront.CachePolicy(
        ...transform(
          args.transform?.cachePolicy,
          `${name}CachePolicy`,
          {
            comment: `${name} router cache policy`,
            defaultTtl: 0,
            maxTtl: 31536000, // 1 year
            minTtl: 0,
            parametersInCacheKeyAndForwardedToOrigin: {
              cookiesConfig: {
                cookieBehavior: "none",
              },
              headersConfig: {
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
        ),
      );
    }

    function createCdn() {
      const origins = buildOrigins();
      const behaviors = buildBehaviors();

      return new Cdn(
        ...transform(
          args.transform?.cdn,
          `${name}Cdn`,
          {
            comment: `${name} router`,
            origins,
            defaultCacheBehavior: behaviors.apply(
              (behaviors) => behaviors.find((b) => !b.pathPattern)!,
            ),
            orderedCacheBehaviors: behaviors.apply(
              (behaviors) =>
                behaviors.filter(
                  (b) => b.pathPattern,
                ) as types.input.cloudfront.DistributionOrderedCacheBehavior[],
            ),
            domain: args.domain,
            invalidation: args.invalidation,
            wait: true,
          },
          { parent },
        ),
      );
    }

    function buildOrigins() {
      const urlDefaultConfig = {
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: "https-only",
          originReadTimeout: 20,
          originSslProtocols: ["TLSv1.2"],
        },
      };

      return output(routes).apply((routes) => {
        const origins = Object.entries(routes).map(([path, route]) => {
          if ("url" in route) {
            return {
              originId: path,
              domainName: new URL(route.url).host,
              ...urlDefaultConfig,
            };
          }

          return {
            originId: path,
            domainName:
              route.bucket instanceof Bucket
                ? route.bucket.nodes.bucket.bucketRegionalDomainName
                : route.bucket!,
            originPath: "",
            originAccessControlId: createOriginAccessControl().id,
          };
        });

        if (!routes["/*"]) {
          origins.push({
            originId: "/*",
            domainName: "do-not-exist.sst.dev",
            ...urlDefaultConfig,
          });
        }
        return origins;
      });
    }

    function buildBehaviors() {
      const urlDefaultConfig = {
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: [
          "DELETE",
          "GET",
          "HEAD",
          "OPTIONS",
          "PATCH",
          "POST",
          "PUT",
        ],
        cachedMethods: ["GET", "HEAD"],
        defaultTtl: 0,
        compress: true,
        cachePolicyId: cachePolicy.id,
        // CloudFront's Managed-AllViewerExceptHostHeader policy
        originRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac",
      };

      const bucketDefaultConfig = {
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        compress: true,
        // CloudFront's managed CachingOptimized policy
        cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
      };

      return output(routes).apply((routes) => {
        const behaviors = Object.entries(routes).map(([path, route]) => ({
          ...(path === "/*" ? {} : { pathPattern: path }),
          targetOriginId: path,
          functionAssociations: [
            ...("url" in route || route.edge?.viewerRequest || route.rewrite
              ? [
                  {
                    eventType: "viewer-request",
                    functionArn:
                      route.edge?.viewerRequest || route.rewrite
                        ? createCfRequestFunction(
                            path,
                            route.edge?.viewerRequest,
                            route.rewrite,
                            "url" in route,
                          ).arn
                        : createCfRequestDefaultFunction().arn,
                  },
                ]
              : []),
            ...(route.edge?.viewerResponse
              ? [
                  {
                    eventType: "viewer-response",
                    functionArn: createCfResponseFunction(
                      path,
                      route.edge.viewerResponse,
                    ).arn,
                  },
                ]
              : []),
          ],
          ...("url" in route ? urlDefaultConfig : bucketDefaultConfig),
        }));

        if (!routes["/*"]) {
          behaviors.push({
            targetOriginId: "/*",
            functionAssociations: [],
            ...urlDefaultConfig,
          });
        }
        return behaviors;
      });
    }
  }

  /**
   * The ID of the Router distribution.
   */
  public get distributionID() {
    return this.cdn.nodes.distribution.id;
  }

  /**
   * The URL of the Router.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the autogenerated CloudFront URL.
   */
  public get url() {
    return all([this.cdn.domainUrl, this.cdn.url]).apply(
      ([domainUrl, url]) => domainUrl ?? url,
    );
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon CloudFront CDN resource.
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

  /**
   * Reference an existing Router with the given Router distribution ID. This is useful when
   * you create a Router in one stage and want to share it in another. It avoids having to
   * create a new Router in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Routers across stages.
   * :::
   *
   * @param name The name of the component.
   * @param distributionID The id of the existing Router distribution.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a Router in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new Router, you want to share the same Router from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const router = $app.stage === "frank"
   *   ? sst.aws.Router.get("MyRouter", "E2IDLMESRN6V62")
   *   : new sst.aws.Router("MyRouter");
   * ```
   *
   * Here `E2IDLMESRN6V62` is the ID of the Router distribution created in the `dev` stage.
   * You can find this by outputting the distribution ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   router: router.distributionID
   * };
   * ```
   */
  public static get(
    name: string,
    distributionID: Input<string>,
    opts?: ComponentResourceOptions,
  ) {
    return new Router(name, {
      ref: true,
      distributionID: distributionID,
    } as unknown as RouterArgs);
  }
}

const __pulumiType = "sst:aws:Router";
// @ts-expect-error
Router.__pulumiType = __pulumiType;
