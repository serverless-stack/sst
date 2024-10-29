/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Next.js add behavior
 *
 * Here's how to add additional routes or cache behaviors to the CDN of a Next.js app deployed
 * with OpenNext to AWS.
 *
 * Specify the path pattern that you want to forward to your new origin. For example, to forward
 * all requests to the `/blog` path to a different origin.
 *
 * ```ts title="sst.config.ts"
 * pathPattern: "/blog/*"
 * ```
 *
 * And then specify the domain of the new origin.
 *
 * ```ts title="sst.config.ts"
 * domainName: "blog.example.com"
 * ```
 *
 * We use this to `transform` our site's CDN and add the additional behaviors.
 */
export default $config({
  app(input) {
    return {
      name: "aws-nextjs-add-behavior",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const blogOrigin = {
      // The domain of the new origin
      domainName: "blog.example.com",
      originId: "blogCustomOrigin",
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originSslProtocols: ["TLSv1.2"],
        // If HTTPS is supported
        originProtocolPolicy: "https-only",
      },
    };

    const cacheBehavior = {
      // The path to forward to the new origin
      pathPattern: "/blog/*",
      targetOriginId: blogOrigin.originId,
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS"],
      cachedMethods: ["GET", "HEAD"],
      forwardedValues: {
        queryString: true,
        cookies: {
          forward: "all",
        },
      },
    };

    new sst.aws.Nextjs("MyWeb", {
      transform: {
        cdn: (options: sst.aws.CdnArgs) => {
          options.origins = $resolve([options.origins]).apply(
            ([val]) => [...val, blogOrigin],
          );

          options.orderedCacheBehaviors = $resolve([
            options.orderedCacheBehaviors || [],
          ]).apply(
            ([val]) => [...val, cacheBehavior],
          );
        },
      },
    });
  },
});
