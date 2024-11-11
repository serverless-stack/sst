/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "www",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  console: {
    autodeploy: {
      target(event) {
        if (
          event.type === "branch" &&
          event.branch === "dev" &&
          event.action === "pushed"
        ) {
          return { stage: "production" };
        }
      },
      workflow(ctx) {
        ctx.install();
        ctx.shell("goenv install 1.21.3 && goenv global 1.21.3");
        ctx.shell("cd ../platform && ./scripts/build");
        ctx.shell("bun i sst-linux-x64");
        ctx.deploy();
      },
    },
  },
  async run() {
    const domain =
      {
        production: "sst.dev",
        dev: "dev.sst.dev",
      }[$app.stage] || $app.stage + "dev.sst.dev";

    // Redirect /examples to guide.sst.dev/examples
    // Redirect /chapters to guide.sst.dev/chapters
    // Redirect /archives to guide.sst.dev/archives
    const redirectToGuideBehavior = {
      targetOriginId: "redirect",
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS"],
      cachedMethods: ["GET", "HEAD"],
      functionAssociations: [
        {
          eventType: "viewer-request",
          functionArn: new aws.cloudfront.Function("AstroRedirect", {
            runtime: "cloudfront-js-2.0",
            code: [
              `async function handler(event) {`,
              `  const request = event.request;`,
              // ie. request.uri is /examples/foo
              `  return {`,
              `    statusCode: 302,`,
              `    statusDescription: 'Found',`,
              `    headers: {`,
              `      location: { value: "https://guide.sst.dev" + request.uri }`,
              `    },`,
              `  };`,
              `}`,
            ].join("\n"),
          }).arn,
        },
      ],
      forwardedValues: {
        queryString: true,
        headers: ["Origin"],
        cookies: { forward: "none" },
      },
    };

    // Stripe .html from /blog
    const stripHtmlBehavior = {
      targetOriginId: "redirect",
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS"],
      cachedMethods: ["GET", "HEAD"],
      functionAssociations: [
        {
          eventType: "viewer-request",
          functionArn: new aws.cloudfront.Function("StripHtml", {
            runtime: "cloudfront-js-2.0",
            code: [
              `async function handler(event) {`,
              `  return {`,
              `    statusCode: 308,`,
              `    headers: {`,
              `      location: { value: event.request.uri.replace(/\.html$/, "") }`,
              `    },`,
              `  };`,
              `}`,
            ].join("\n"),
          }).arn,
        },
      ],
      forwardedValues: {
        queryString: true,
        headers: ["Origin"],
        cookies: { forward: "none" },
      },
    };

    new sst.aws.Astro("Astro", {
      domain:
        $app.stage === "production"
          ? {
              name: domain,
              redirects: [
                "www.sst.dev",
                "ion.sst.dev",
                "serverless-stack.com",
                "www.serverless-stack.com",
              ],
            }
          : domain,
      transform: {
        cdn: (args) => {
          args.origins = $output(args.origins).apply((origins) => [
            ...origins,
            {
              domainName: "guide.sst.dev",
              originId: "redirect",
              customOriginConfig: {
                httpPort: 80,
                httpsPort: 443,
                originProtocolPolicy: "https-only",
                originReadTimeout: 20,
                originSslProtocols: ["TLSv1.2"],
              },
            },
          ]);
          args.orderedCacheBehaviors = $output(
            args.orderedCacheBehaviors
          ).apply((cacheBehaviors) => [
            ...(cacheBehaviors || []),
            { pathPattern: "/blog/*.html", ...stripHtmlBehavior },
            { pathPattern: "/examples*", ...redirectToGuideBehavior },
            { pathPattern: "/chapters*", ...redirectToGuideBehavior },
            { pathPattern: "/archives*", ...redirectToGuideBehavior },
          ]);
        },
      },
    });

    new sst.aws.Router("TelemetryRouter", {
      domain: "telemetry.ion." + domain,
      routes: {
        "/*": "https://us.i.posthog.com",
      },
    });
  },
});
