/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-zero",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("Vpc", {
      bastion: true,
    });
    const db = new sst.aws.Postgres("Database", {
      vpc,
      transform: {
        parameterGroup: {
          parameters: [
            {
              name: "rds.logical_replication",
              value: "1",
              applyMethod: "pending-reboot",
            },
            {
              name: "rds.force_ssl",
              value: "0",
              applyMethod: "pending-reboot",
            },
            {
              name: "max_connections",
              value: "1000",
              applyMethod: "pending-reboot",
            },
          ],
        },
      },
    });
    const cluster = new sst.aws.Cluster("Cluster", { vpc });
    const connection = $interpolate`postgres://${db.username}:${db.password}@${db.host}:${db.port}`;
    cluster.addService("Zero", {
      image: "rocicorp/zero",
      dev: {
        command: "npx zero-cache",
      },
      loadBalancer: {
        ports: [{ listen: "80/http", forward: "4848/http" }],
      },
      environment: {
        ZERO_UPSTREAM_DB: $interpolate`${connection}/${db.database}`,
        ZERO_CVR_DB: $interpolate`${connection}/${db.database}_cvr`,
        ZERO_CHANGE_DB: $interpolate`${connection}/${db.database}_change`,
        ZERO_REPLICA_FILE: "zero.db",
        ZERO_NUM_SYNC_WORKERS: "1",
      },
    });

    return {
      connection: $interpolate`${connection}/${db.database}`,
    };
  },
});
