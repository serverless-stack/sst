/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "cloudflare-drizzle",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "cloudflare",
    };
  },
  async run() {
    const secrets = {
      TursoUrl: new sst.Secret("TursoUrl"),
      TursoAuthToken: new sst.Secret("TursoAuthToken")
    };

    const worker = new sst.cloudflare.Worker("Worker", {
      link: [
        secrets.TursoUrl,
        secrets.TursoAuthToken,
      ],
      url: true,
      handler: "./src/worker.ts",
    });

    return {
      url: worker.url,
    };
  },
});
