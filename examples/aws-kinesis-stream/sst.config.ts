/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## Kinesis streams
 *
 * Create a Kinesis stream, and subscribe to it with a function.
 */
export default $config({
  app(input) {
    return {
      name: "aws-kinesis-stream",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const stream = new sst.aws.KinesisStream("MyStream");

    // Create a function subscribing to all events
    stream.subscribe("AllSub", "subscriber.all");

    // Create a function subscribing to events of `bar` type
    stream.subscribe("FilteredSub", "subscriber.filtered", {
      filters: [
        {
          data: {
            type: ["bar"],
          },
        },
      ],
    });

    const app = new sst.aws.Function("MyApp", {
      handler: "publisher.handler",
      link: [stream],
      url: true,
    });

    return {
      app: app.url,
      stream: stream.name,
    };
  },
});
