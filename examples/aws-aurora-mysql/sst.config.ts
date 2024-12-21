/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-aurora-mysql",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", {
      nat: "ec2",
      bastion: true,
    });

    const database = new sst.aws.Mysql("MyDatabase", {
      version: '8.0.mysql_aurora.3.08.0',
      scaling: {
        min: "0 ACU",
        max: "2 ACU",
        secondsUntilAutoPause: 301,
      },
      vpc
    });

    return {
      DatabaseUsername: database.username,
      // DatabasePassword: database.password,
      DatabasePassword: database.secretArn,
    };
  },
});
