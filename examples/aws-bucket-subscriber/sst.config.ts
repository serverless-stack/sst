/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## Bucket notifications
 *
 * Create an S3 bucket and subscribe to its events with a function.
 */
export default $config({
  app(input) {
    return {
      name: "aws-bucket-subscriber",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket");
    bucket.notify({
      notifications: [
        {
          name: "MySubscriber",
          function: "subscriber.handler",
          events: ["s3:ObjectCreated:*"],
        },
      ],
    });

    return {
      bucket: bucket.name,
    };
  },
});
