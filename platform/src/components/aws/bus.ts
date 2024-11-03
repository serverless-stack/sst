import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Component, outputId, Transform, transform } from "../component";
import { Link } from "../link";
import type { Input } from "../input";
import { FunctionArgs, FunctionArn } from "./function";
import { hashStringToPrettyString, physicalName, logicalName } from "../naming";
import { parseEventBusArn } from "./helpers/arn";
import { BusLambdaSubscriber } from "./bus-lambda-subscriber";
import { cloudwatch } from "@pulumi/aws";
import { permission } from "./permission";
import { Queue } from "./queue";
import { BusQueueSubscriber } from "./bus-queue-subscriber";

export interface BusArgs {
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the EventBus resource.
     */
    bus?: Transform<cloudwatch.EventBusArgs>;
  };
}

export interface BusSubscriberArgs {
  /**
   * Filter the messages that'll be processed by the subscriber.
   *
   * If any single property in the pattern doesn't match
   * an attribute assigned to the message, then the pattern rejects the message.
   *
   *
   * :::tip
   * Learn more about [event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html).
   * :::
   *
   * @example
   * For example, if your EventBus message contains this in a JSON format.
   * ```js
   * {
   *   source: "my.source",
   *   detail: {
   *      price_usd: 210.75
   *   },
   *   "detail-type": "orderPlaced",
   * }
   * ```
   *
   * Then this pattern accepts the message.
   *
   * ```js
   * {
   *   pattern: {
   *     source: ["my.source", "my.source2"],
   *   }
   * }
   * ```
   */
  pattern?: Input<{
    /**
     * A list of "source" values to match against. "source" indicates where the event
     * originated.
     *
     * @example
     * ```js
     * {
     *   pattern: {
     *     source: "my.source"
     *   },
     * }
     * ```
     */
    source?: (string | any)[];
    /**
     * A JSON object of "detail" values to match against. "detail" contains the actual
     * data or information associated with the event.
     *
     * @example
     * ```js
     * {
     *   pattern: {
     *     price_usd: [{numeric: [">=", 100]}]
     *   },
     * }
     * ```
     */
    detail?: { [key: string]: any };
    /**
     * A list of "detail-type" values to match against. "detail-type" typically defines
     * the kind of event that is occurring.
     *
     * @example
     * ```js
     * {
     *   pattern: {
     *     detailType: ["orderPlaced"]
     *   },
     * }
     * ```
     */
    detailType?: (string | any)[];
  }>;
  /**
   * [Transform](/docs/components#transform) how this subscription creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the EventBus rule resource.
     */
    rule?: Transform<cloudwatch.EventRuleArgs>;
    /**
     * Transform the EventBus target resource.
     */
    target?: Transform<cloudwatch.EventTargetArgs>;
  };
}

/**
 * The `Bus` component lets you add an [Amazon EventBridge Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html) to your app.
 *
 * @example
 *
 * #### Create a bus
 *
 * ```ts
 * const bus = new sst.aws.Bus("MyBus");
 * ```
 *
 * #### Add a subscriber
 *
 * ```ts
 * bus.subscribe("src/subscriber.handler");
 * ```
 *
 * #### Link the bus to a resource
 *
 * You can link the bus to other resources, like a function or your Next.js app.
 *
 * ```ts
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [bus]
 * });
 * ```
 *
 * Once linked, you can publish messages to the bus from your function code.
 *
 * ```ts title="app/page.tsx" {1,7}
 * import { Resource } from "sst";
 * import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
 *
 * const eb = new EventBridgeClient({});
 *
 * await eb.send(new PutEventsCommand({
 *   Entries: [
 *     {
 *       EventBusName: Resource.MyBus.name,
 *       Source: "my.source",
 *       Detail: JSON.stringify({ foo: "bar" }),
 *     }
 *   ],
 * }));
 * ```
 */
export class Bus extends Component implements Link.Linkable {
  private constructorName: string;
  private constructorOpts: ComponentResourceOptions;
  private bus: cloudwatch.EventBus;

  constructor(
    name: string,
    args: BusArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const bus = createBus();

    this.constructorName = name;
    this.constructorOpts = opts;
    this.bus = bus;

    function createBus() {
      return new cloudwatch.EventBus(
        ...transform(
          args.transform?.bus,
          `${name}Bus`,
          {
            name: physicalName(256, name),
          },
          { parent },
        ),
      );
    }
  }

  /**
   * The name of the EventBus.
   */
  public get name() {
    return this.bus.name;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon EventBus resource.
       */
      bus: this.bus,
    };
  }

  /**
   * Subscribe to this EventBus.
   *
   * @param name The name of the subscription.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js
   * bus.subscribe("MySubscription", "src/subscriber.handler");
   * ```
   *
   * Add a pattern to the subscription.
   *
   * ```js
   * bus.subscribe("MySubscription", "src/subscriber.handler", {
   *   pattern: {
   *     source: ["my.source", "my.source2"],
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js
   * bus.subscribe("MySubscription", {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   *
   * Or pass in the ARN of an existing Lambda function.
   *
   * ```js title="sst.config.ts"
   * bus.subscribe("arn:aws:lambda:us-east-1:123456789012:function:my-function");
   * ```
   */
  public subscribe(
    name: string,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args: BusSubscriberArgs = {},
  ) {
    return Bus._subscribeFunction(
      this.constructorName,
      name,
      this.nodes.bus.name,
      this.nodes.bus.arn,
      subscriber,
      args,
      { provider: this.constructorOpts.provider },
    );
  }

  /**
   * Subscribe to an EventBus that was not created in your app.
   *
   * @param name The name of the subscription.
   * @param busArn The ARN of the EventBus to subscribe to.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing EventBus with the following ARN.
   *
   * ```js
   * const busArn = "arn:aws:events:us-east-1:123456789012:event-bus/my-bus";
   * ```
   *
   * You can subscribe to it by passing in the ARN.
   *
   * ```js
   * sst.aws.Bus.subscribe("MySubscription", busArn, "src/subscriber.handler");
   * ```
   *
   * Add a pattern to the subscription.
   *
   * ```js
   * sst.aws.Bus.subscribe("MySubscription", busArn, "src/subscriber.handler", {
   *   pattern: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js
   * sst.aws.Bus.subscribe("MySubscription", busArn, {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public static subscribe(
    name: string,
    busArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: BusSubscriberArgs,
  ) {
    return output(busArn).apply((busArn) => {
      const busName = parseEventBusArn(busArn).busName;
      return this._subscribeFunction(
        busName,
        name,
        busName,
        busArn,
        subscriber,
        args,
      );
    });
  }

  private static _subscribeFunction(
    name: string,
    subscriberName: string,
    busName: Input<string>,
    busArn: string | Output<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args: BusSubscriberArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    return output(args).apply((args) => {
      return new BusLambdaSubscriber(
        `${name}Subscriber${subscriberName}`,
        {
          bus: { name: busName, arn: busArn },
          subscriber,
          ...args,
        },
        opts,
      );
    });
  }

  /**
   * Subscribe to this EventBus with an SQS Queue.
   *
   * @param name The name of the subscription.
   * @param queue The ARN of the queue or `Queue` component that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have a queue.
   *
   * ```js title="sst.config.ts"
   * const queue = sst.aws.Queue("MyQueue");
   * ```
   *
   * You can subscribe to this bus with it.
   *
   * ```js title="sst.config.ts"
   * bus.subscribeQueue(queue);
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * bus.subscribeQueue(queue, {
   *   filter: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   */
  public subscribeQueue(
    name: string,
    queue: Input<string | Queue>,
    args: BusSubscriberArgs = {},
  ) {
    return Bus._subscribeQueue(
      this.constructorName,
      name,
      this.nodes.bus.arn,
      this.nodes.bus.name,
      queue,
      args,
    );
  }

  /**
   * Subscribe to an existing EventBus with a previously created SQS Queue.
   *
   * @param name The name of the subscription.
   * @param busArn The ARN of the EventBus to subscribe to.
   * @param queue The ARN of the queue or `Queue` component that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing EventBus and SQS Queue with the following ARNs.
   *
   * ```js title="sst.config.ts"
   * const busArn = "arn:aws:events:us-east-1:123456789012:event-bus/MyBus";
   * const queueArn = "arn:aws:sqs:us-east-1:123456789012:MyQueue";
   * ```
   *
   * You can subscribe to the bus with the queue.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bus.subscribeQueue(busArn, queueArn);
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bus.subscribeQueue(busArn, queueArn, {
   *   filter: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   */
  public static subscribeQueue(
    name: string,
    busArn: Input<string>,
    queue: Input<string | Queue>,
    args?: BusSubscriberArgs,
  ) {
    return output(busArn).apply((busArn) => {
      const busName = parseEventBusArn(busArn).busName;
      return this._subscribeQueue(busName, name, busArn, busName, queue, args);
    });
  }

  private static _subscribeQueue(
    name: string,
    subscriberName: string,
    busArn: Input<string>,
    busName: Input<string>,
    queue: Input<string | Queue>,
    args: BusSubscriberArgs = {},
  ) {
    return output(args).apply((args) => {
      return new BusQueueSubscriber(`${name}Subscriber${subscriberName}`, {
        bus: { name: busName, arn: busArn },
        queue,
        ...args,
      });
    });
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        name: this.name,
        arn: this.nodes.bus.arn,
      },
      include: [
        permission({
          actions: ["events:*"],
          resources: [this.nodes.bus.arn],
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:Bus";
// @ts-expect-error
Bus.__pulumiType = __pulumiType;
