/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "{{.App}}",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "{{.Home}}",
    };
  },
  async run() {
    new sst.{{.Home}}.StaticSite("MyWeb", {
      dev: {
        command: "npm run start"
      },
      build: {
        output: "dist/browser",
        command: "ng build --output-path dist"
      },
    });
  },
});

