/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-rust-loco",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("LocoVpc", {
      bastion: true,
    });

    const database = new sst.aws.Postgres("LocoDatabase", { vpc });

    const redis = new sst.aws.Redis("LocoRedis", { vpc });

    const DATABASE_URL = $interpolate`postgres://${database.username}:${database.password.apply(encodeURIComponent)
      }@${database.host}:${database.port}/${database.database}`;
    const REDIS_URL = $interpolate`redis://${redis.username}:${redis.password.apply(encodeURIComponent)
      }@${redis.host}:${redis.port}`;

    const locoCluster = new sst.aws.Cluster("LocoCluster", { vpc });

    // external facing http service
    const locoServer = locoCluster.addService("LocoApp", {
      architecture: "x86_64",
      scaling: { min: 2, max: 4 },
      command: ["start"],
      loadBalancer: {
        ports: [{ listen: "80/http", forward: "5150/http" }],
      },
      environment: {
        DATABASE_URL,
        REDIS_URL,
      },
      link: [database, redis],
      dev: {
        command: "cargo loco start",
      },
    });

    // add a worker that uses redis to process jobs off a queue
    locoCluster.addService("LocoWorker", {
      architecture: "x86_64",
      command: ["start", "--worker"],
      environment: {
        DATABASE_URL,
        REDIS_URL,
      },
      link: [database, redis],
    });
  },
});
