/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS SolidStart WebSocket endpoint
 *
 * Deploys a SolidStart app with a [WebSocket endpoint](https://docs.solidjs.com/solid-start/advanced/websocket)
 * in a container to AWS.
 *
 * Uses the experimental WebSocket support in Nitro.
 *
 * ```ts title="app.config.ts" {4}
 * export default defineConfig({
 *   server: {
 *     experimental: {
 *       websocket: true,
 *     },
 *   },
 * }).addRouter({
 *   name: "ws",
 *   type: "http",
 *   handler: "./src/ws.ts",
 *   target: "server",
 *   base: "/ws",
 * });
 * ```
 *
 * Once deployed you can test the `/ws` endpoint and it'll send a message back after a 3s delay.
 */
export default $config({
  app(input) {
    return {
      name: "aws-solid-container-ws",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { bastion: true });
    const cluster = new sst.aws.Cluster("MyCluster", { vpc });

    cluster.addService("MyService", {
      loadBalancer: {
        ports: [{ listen: "80/http", forward: "3000/http" }],
      },
      dev: {
        command: "npm run dev",
      },
    });
  },
});
