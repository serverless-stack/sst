/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## Bucket queue notifications
 *
 * Create an S3 bucket and subscribe to its events with an SQS queue.
 */
export default $config({
  app(input) {
    return {
      name: "aws-bucket-queue-subscriber",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const queue = new sst.aws.Queue("MyQueue");
    queue.subscribe("subscriber.handler");

    const bucket = new sst.aws.Bucket("MyBucket");
    bucket.notify({
      notifications: [
        {
          name: "MySubscriber",
          queue,
          events: ["s3:ObjectCreated:*"],
        },
      ],
    });

    return {
      bucket: bucket.name,
      queue: queue.url,
    };
  },
});
