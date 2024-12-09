/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-pothos-graphql",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    if ($dev) {
      new sst.x.DevCommand("PothosGraphqlExtractor", {
        dev: {
          command: "bun --watch run pothos/extract.ts",
          autostart: true,
        },
      });
    }

    const api = new sst.aws.ApiGatewayV2("Api");
    api.route("POST /graphql", "pothos/graphql.handler");

    const client = new sst.aws.Function("Client", {
      url: true,
      link: [api],
      handler: "client.handler",
    });

    return {
      api: api.url,
      client: client.url,
    };
  },
});
