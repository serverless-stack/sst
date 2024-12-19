/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Lambda retry with queues
 *
 * An example on how to retry Lambda invocations using SQS queues.
 *
 * Create a SQS retry queue which will be set as the destination for the Lambda function.
 *
 * ```ts title="src/retry.ts"
 * const retryQueue = new sst.aws.Queue("retryQueue");
 *
 * const bus = new sst.aws.Bus("bus");
 *
 * const busSubscriber = bus.subscribe("busSubscriber", {
 *   handler: "src/bus-subscriber.handler",
 *   environment: {
 *     RETRIES: "2", // set the number of retries
 *   },
 *   link: [retryQueue], // so the function can send messages to the retry queue
 * });
 *
 * new aws.lambda.FunctionEventInvokeConfig("eventConfig", {
 *   functionName: $resolve([busSubscriber.nodes.function.name]).apply(
 *     ([name]) => name,
 *   ),
 *   maximumRetryAttempts: 2, // default is 2, must be between 0 and 2
 *   destinationConfig: {
 *     onFailure: {
 *       destination: retryQueue.arn,
 *     },
 *   },
 * });
 * ```
 *
 * Create a bus subscriber which will publish messages to the bus. Include a DLQ for messages that continue to fail.
 *
 * ```ts title="sst.config.ts"
 *
 * const dlq = new sst.aws.Queue("dlq");
 *
 * retryQueue.subscribe({
 *   handler: "src/retry.handler",
 *   link: [busSubscriber.nodes.function, retryQueue, dlq],
 *   timeout: "30 seconds",
 *   environment: {
 *     RETRIER_QUEUE_URL: retryQueue.url,
 *   },
 *   permissions: [
 *     {
 *       actions: ["lambda:GetFunction", "lambda:InvokeFunction"],
 *       resources: [
 *         $interpolate`arn:aws:lambda:${aws.getRegionOutput().name}:${
 *           aws.getCallerIdentityOutput().accountId
 *         }:function:*`,
 *       ],
 *     },
 *   ],
 *   transform: {
 *     function: {
 *       deadLetterConfig: {
 *         targetArn: dlq.arn,
 *       },
 *     },
 *   },
 * });
 * ```
 *
 *
 * The Retry function will read mesaages and send back to the queue to be retried with a backoff.
 *
 * ```ts title="src/retry.ts"
 * export const handler: SQSHandler = async (evt) => {
 *   for (const record of evt.Records) {
 *     const parsed = JSON.parse(record.body);
 *     console.log("body", parsed);
 *     const functionName = parsed.requestContext.functionArn
 *       .replace(":$LATEST", "")
 *       .split(":")
 *       .pop();
 *     if (parsed.responsePayload) {
 *       const attempt = (parsed.requestPayload.attempts || 0) + 1;
 *
 *       const info = await lambda.send(
 *         new GetFunctionCommand({
 *           FunctionName: functionName,
 *         }),
 *       );
 *       const max =
 *         Number.parseInt(
 *           info.Configuration?.Environment?.Variables?.RETRIES || "",
 *         ) || 0;
 *       console.log("max retries", max);
 *       if (attempt > max) {
 *         console.log(`giving up after ${attempt} retries`);
 *         // send to dlq
 *         await sqs.send(
 *           new SendMessageCommand({
 *             QueueUrl: Resource.dlq.url,
 *             MessageBody: JSON.stringify({
 *               requestPayload: parsed.requestPayload,
 *               requestContext: parsed.requestContext,
 *               responsePayload: parsed.responsePayload,
 *             }),
 *           }),
 *         );
 *         return;
 *       }
 *       const seconds = Math.min(Math.pow(2, attempt), 900);
 *       console.log(
 *         "delaying retry by ",
 *         seconds,
 *         "seconds for attempt",
 *         attempt,
 *       );
 *       parsed.requestPayload.attempts = attempt;
 *       await sqs.send(
 *         new SendMessageCommand({
 *           QueueUrl: Resource.retryQueue.url,
 *           DelaySeconds: seconds,
 *           MessageBody: JSON.stringify({
 *             requestPayload: parsed.requestPayload,
 *             requestContext: parsed.requestContext,
 *           }),
 *         }),
 *       );
 *     }
 *
 *     if (!parsed.responsePayload) {
 *       console.log("triggering function");
 *       try {
 *         await lambda.send(
 *           new InvokeCommand({
 *             InvocationType: "Event",
 *             Payload: Buffer.from(JSON.stringify(parsed.requestPayload)),
 *             FunctionName: functionName,
 *           }),
 *         );
 *       } catch (e) {
 *         if (e instanceof ResourceNotFoundException) {
 *           return;
 *         }
 *         throw e;
 *       }
 *     }
 *   }
 * };
 * ```
 */
export default $config({
  app(input) {
    return {
      name: "sst-v3-lambda-retries",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const dlq = new sst.aws.Queue("dlq");

    const retryQueue = new sst.aws.Queue("retryQueue");

    const bus = new sst.aws.Bus("bus");

    const busSubscriber = bus.subscribe("busSubscriber", {
      handler: "src/bus-subscriber.handler",
      environment: {
        RETRIES: "2",
      },
      link: [retryQueue], // so the function can send messages to the queue
    });

    const publisher = new sst.aws.Function("publisher", {
      handler: "src/publisher.handler",
      link: [bus],
      url: true,
    });

    new aws.lambda.FunctionEventInvokeConfig("eventConfig", {
      functionName: $resolve([busSubscriber.nodes.function.name]).apply(
        ([name]) => name,
      ),
      maximumRetryAttempts: 1,
      destinationConfig: {
        onFailure: {
          destination: retryQueue.arn,
        },
      },
    });

    retryQueue.subscribe({
      handler: "src/retry.handler",
      link: [busSubscriber.nodes.function, retryQueue, dlq],
      timeout: "30 seconds",
      environment: {
        RETRIER_QUEUE_URL: retryQueue.url,
      },
      permissions: [
        {
          actions: ["lambda:GetFunction", "lambda:InvokeFunction"],
          resources: [
            $interpolate`arn:aws:lambda:${aws.getRegionOutput().name}:${
              aws.getCallerIdentityOutput().accountId
            }:function:*`,
          ],
        },
      ],
      transform: {
        function: {
          deadLetterConfig: {
            targetArn: dlq.arn,
          },
        },
      },
    });

    return {
      publisher: publisher.url,
      dlq: dlq.url,
      retryQueue: retryQueue.url,
    };
  },
});
