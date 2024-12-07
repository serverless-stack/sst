/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-drizzle",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { bastion: true, nat: "ec2" });
    const rds = new sst.aws.Postgres("MyPostgres", { vpc, proxy: true });

    new sst.aws.Function("MyApi", {
      vpc,
      url: true,
      link: [rds],
      handler: "src/api.handler",
    });

    new sst.x.DevCommand("Studio", {
      link: [rds],
      dev: {
        command: "npx drizzle-kit studio",
      },
    });
  },
});
