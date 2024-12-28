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
    new sst.{{.Home}}.Astro("MyWeb");
  },
});
