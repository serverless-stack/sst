/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "playground",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const ret: Record<string, $util.Output<string>> = {};

    const vpc = addVpc();
    const bucket = addBucket();
    //const queue = addQueue();
    //const efs = addEfs();
    //const email = addEmail();
    //const apiv1 = addApiV1();
    //const apiv2 = addApiV2();
    //const router = addRouter();
    //const app = addFunction();
    //const service = addService();
    //const postgres = addPostgres();
    //const redis = addRedis();
    //const cron = addCron();
    //const topic = addTopic();
    //const bus = addBus();

    return ret;

    function addVpc() {
      const vpc = new sst.aws.Vpc("MyVpc");
      return vpc;
    }

    function addBucket() {
      const bucket = new sst.aws.Bucket("MyBucket");
      ret.bucket = bucket.name;
      return bucket;
    }

    function addQueue() {
      const queue = new sst.aws.Queue("MyQueue");
      queue.subscribe("functions/queue/index.subscriber");

      new sst.aws.Function("MyQueuePublisher", {
        handler: "functions/queue/index.publisher",
        link: [queue],
        url: true,
      });

      return queue;
    }

    function addEfs() {
      const efs = new sst.aws.Efs("MyEfs", { vpc });
      ret.efs = efs.id;
      ret.efsAccessPoint = efs.nodes.accessPoint.id;

      const app = new sst.aws.Function("MyEfsApp", {
        handler: "functions/efs/index.handler",
        volume: { efs },
        url: true,
        vpc,
      });
      ret.efsApp = app.url;

      return efs;
    }

    function addEmail() {
      const topic = new sst.aws.SnsTopic("MyTopic");
      topic.subscribe(
        "MyTopicSubscriber",
        "functions/email/index.notification"
      );

      const email = new sst.aws.Email("MyEmail", {
        sender: "wangfanjie@gmail.com",
        events: [
          {
            name: "notif",
            types: ["delivery"],
            topic: topic.arn,
          },
        ],
      });

      const sender = new sst.aws.Function("MyApi", {
        handler: "functions/email/index.sender",
        link: [email],
        url: true,
      });

      ret.emailSend = sender.url;
      ret.email = email.sender;
      ret.emailConfig = email.configSet;
      return ret;
    }

    function addApiV1() {
      const api = new sst.aws.ApiGatewayV1("MyApiV1");
      api.route("GET /", {
        handler: "functions/apiv2/index.handler",
        link: [bucket],
      });
      api.deploy();
      return api;
    }

    function addApiV2() {
      const api = new sst.aws.ApiGatewayV2("MyApiV2", {
        link: [bucket],
      });
      api.route("GET /", {
        handler: "functions/apiv2/index.handler",
      });
      return api;
    }

    function addRouter() {
      const app = new sst.aws.Function("MyApp", {
        handler: "functions/router/index.handler",
        url: true,
      });
      const router = new sst.aws.Router("MyRouter", {
        domain: "router.playground.sst.sh",
        routes: {
          "/api/*": app.url,
        },
      });
      const router2 = sst.aws.Router.get("MyRouter2", router.distributionID);
      return router;
    }

    function addFunction() {
      const app = new sst.aws.Function("MyApp", {
        handler: "functions/handler-example/index.handler",
        link: [bucket],
        url: true,
      });
      ret.app = app.url;
      return app;
    }

    function addService() {
      const cluster = new sst.aws.Cluster("MyCluster", { vpc });
      const service = cluster.addService("MyService", {
        loadBalancer: {
          ports: [{ listen: "80/http" }],
        },
        image: {
          context: "cluster",
        },
        link: [bucket],
      });
      return service;
    }

    function addPostgres() {
      const postgres = new sst.aws.Postgres("MyPostgres", {
        vpc,
      });
      new sst.aws.Function("MyPostgresApp", {
        handler: "functions/postgres/index.handler",
        url: true,
        vpc,
        link: [postgres],
      });
      ret.pgHost = postgres.host;
      ret.pgPort = $interpolate`${postgres.port}`;
      ret.pgUsername = postgres.username;
      ret.pgPassword = postgres.password;
      return postgres;
    }

    function addRedis() {
      const redis = new sst.aws.Redis("MyRedis", { vpc });
      const app = new sst.aws.Function("MyRedisApp", {
        handler: "functions/redis/index.handler",
        url: true,
        vpc,
        link: [redis],
      });
      return redis;
    }

    function addCron() {
      const cron = new sst.aws.Cron("MyCron", {
        schedule: "rate(1 minute)",
        job: {
          handler: "functions/handler-example/index.handler",
          link: [bucket],
        },
      });
      ret.cron = cron.nodes.job.name;
      return cron;
    }

    function addTopic() {
      const topic = new sst.aws.SnsTopic("MyTopic");
      topic.subscribe("MyTopicSubscriber", "functions/topic/index.subscriber");

      new sst.aws.Function("MyTopicPublisher", {
        handler: "functions/topic/index.publisher",
        link: [topic],
        url: true,
      });

      return topic;
    }

    function addBus() {
      const bus = new sst.aws.Bus("MyBus");
      bus.subscribe("functions/bus/index.subscriber", {
        pattern: {
          source: ["app.myevent"],
        },
      });
      bus.subscribeQueue("test", queue);

      new sst.aws.Function("MyBusPublisher", {
        handler: "functions/bus/index.publisher",
        link: [bus],
        url: true,
      });

      return bus;
    }
  },
});
